-- Guest sans abonnement prêteur : à la validation d'une offre, fulfillment = awaiting_subscription (pas shipping).
-- Après souscription active (segna_plus / segna_x), promotion vers shipping (RPC service_role + wrapper auth).

do $do$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    join pg_namespace n on t.typnamespace = n.oid
    where n.nspname = 'public'
      and t.typname = 'item_intake_fulfillment_stage'
      and e.enumlabel = 'awaiting_subscription'
  ) then
    alter type public.item_intake_fulfillment_stage add value 'awaiting_subscription';
  end if;
end;
$do$;

create or replace function public.user_has_active_lender_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and exists (
      select 1
      from public.user_subscriptions s
      where s.user_id = p_user_id
        and s.provider = 'stripe'
        and lower(coalesce(s.status, '')) in ('active', 'trialing')
        and lower(coalesce(s.plan_code, '')) in ('segna_plus', 'segna_x')
    );
$$;

revoke all on function public.user_has_active_lender_subscription(uuid) from public;

comment on function public.user_has_active_lender_subscription(uuid) is
  'True si l’utilisateur a un abonnement prêteur Stripe actif ou en essai.';

create or replace function public.item_intake_before_update_member_fulfillment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if coalesce((select auth.jwt()) ->> 'role', '') = 'authenticated'
     and new.fulfillment_stage is distinct from old.fulfillment_stage
  then
    raise exception 'item_intake.fulfillment_stage: mise a jour reservee au service role';
  end if;

  if new.listing_stage::text = 'validated'
     and old.listing_stage::text = 'validation_pending'
     and new.fulfillment_stage is null
  then
    select i.owner_user_id into v_owner from public.items i where i.id = new.item_id limit 1;

    if coalesce(new.metadata ->> 'intake_path', '') = 'pre_subscribe_proposal' then
      new.fulfillment_stage := 'pre_subscribe_eligible'::public.item_intake_fulfillment_stage;
    elsif public.user_has_active_lender_subscription(v_owner) then
      new.fulfillment_stage := 'shipping'::public.item_intake_fulfillment_stage;
    else
      new.fulfillment_stage := 'awaiting_subscription'::public.item_intake_fulfillment_stage;
    end if;
  end if;

  return new;
end;
$$;

comment on column public.item_intake.fulfillment_stage is
  'shipping / in_verification / verified / refused / pre_subscribe_eligible (parcours proposition) / awaiting_subscription (offre validée, en attente abonnement prêteur).';

create or replace function public._apply_promote_pending_lender_intakes_to_shipping(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_user_id is null then
    return 0;
  end if;

  update public.item_intake ii
  set
    fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage,
    updated_at = now()
  from public.items i
  where ii.item_id = i.id
    and i.owner_user_id = p_user_id
    and i.deleted_at is null
    and ii.deleted_at is null
    and ii.listing_stage = 'validated'::public.item_intake_listing_stage
    and (
      ii.fulfillment_stage = 'awaiting_subscription'::public.item_intake_fulfillment_stage
      or (
        ii.fulfillment_stage = 'pre_subscribe_eligible'::public.item_intake_fulfillment_stage
        and coalesce(ii.metadata ->> 'intake_path', '') = 'pre_subscribe_proposal'
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public._apply_promote_pending_lender_intakes_to_shipping(uuid) from public;

create or replace function public.promote_pre_subscribe_intakes_to_shipping()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_count := public._apply_promote_pending_lender_intakes_to_shipping(v_uid);
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

create or replace function public.promote_pre_subscribe_intakes_to_shipping_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce((select auth.jwt()) ->> 'role', '');
  v_count int;
begin
  if v_role is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user');
  end if;

  v_count := public._apply_promote_pending_lender_intakes_to_shipping(p_user_id);
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

revoke all on function public.promote_pre_subscribe_intakes_to_shipping() from public;
grant execute on function public.promote_pre_subscribe_intakes_to_shipping() to authenticated;

revoke all on function public.promote_pre_subscribe_intakes_to_shipping_for_user(uuid) from public;
grant execute on function public.promote_pre_subscribe_intakes_to_shipping_for_user(uuid) to service_role;

comment on function public.promote_pre_subscribe_intakes_to_shipping() is
  'Passe en shipping les intakes validated en awaiting_subscription ou pre_subscribe_eligible (proposition) pour auth.uid().';

comment on function public.promote_pre_subscribe_intakes_to_shipping_for_user(uuid) is
  'Idem promote_pre_subscribe_intakes_to_shipping pour un user_id donné (service_role, webhooks / jobs).';
