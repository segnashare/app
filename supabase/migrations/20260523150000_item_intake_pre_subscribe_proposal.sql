-- Parcours « proposition de prêt sans abonnement » : à la validation annonce, pas d’expédition auto
-- (fulfillment = pre_subscribe_eligible) tant que le membre n’a pas souscrit ; promotion vers shipping via RPC.

do $do$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    join pg_namespace n on t.typnamespace = n.oid
    where n.nspname = 'public'
      and t.typname = 'item_intake_fulfillment_stage'
      and e.enumlabel = 'pre_subscribe_eligible'
  ) then
    alter type public.item_intake_fulfillment_stage add value 'pre_subscribe_eligible';
  end if;
end;
$do$;

alter table public.items
  add column if not exists pre_subscribe_proposal boolean not null default false;

comment on column public.items.pre_subscribe_proposal is
  'Creation via /items/proposal: on validation, intake fulfillment = pre_subscribe_eligible (no auto shipping).';

create or replace function public.items_after_insert_ensure_item_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := '{}'::jsonb;
begin
  if coalesce(new.pre_subscribe_proposal, false) is true then
    v_meta := jsonb_build_object('intake_path', 'pre_subscribe_proposal');
  elsif new.status::text = 'draft_deleted' then
    v_meta := jsonb_build_object('legacy_items_status', 'draft_deleted');
  end if;

  insert into public.item_intake (item_id, listing_stage, metadata)
  values (
    new.id,
    case new.status::text
      when 'draft' then 'draft'::public.item_intake_listing_stage
      when 'draft_deleted' then 'draft'::public.item_intake_listing_stage
      when 'listed' then 'validated'::public.item_intake_listing_stage
      else 'validated'::public.item_intake_listing_stage
    end,
    v_meta
  )
  on conflict (item_id) do nothing;
  return new;
end;
$$;

create or replace function public.item_intake_before_update_member_fulfillment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    if coalesce(new.metadata ->> 'intake_path', '') = 'pre_subscribe_proposal' then
      new.fulfillment_stage := 'pre_subscribe_eligible'::public.item_intake_fulfillment_stage;
    else
      new.fulfillment_stage := 'shipping'::public.item_intake_fulfillment_stage;
    end if;
  end if;
  return new;
end;
$$;

comment on column public.item_intake.fulfillment_stage is
  'shipping / in_verification / verified / refused / pre_subscribe_eligible (proposal before subscription, no shipping until promoted).';

-- Après souscription : passage expédition pour les pièces concernées (appelle côté client au bon moment).
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

  update public.item_intake ii
  set
    fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage,
    updated_at = now()
  from public.items i
  where ii.item_id = i.id
    and i.owner_user_id = v_uid
    and i.deleted_at is null
    and ii.deleted_at is null
    and ii.listing_stage = 'validated'::public.item_intake_listing_stage
    and ii.fulfillment_stage = 'pre_subscribe_eligible'::public.item_intake_fulfillment_stage
    and coalesce(ii.metadata ->> 'intake_path', '') = 'pre_subscribe_proposal';

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

revoke all on function public.promote_pre_subscribe_intakes_to_shipping() from public;
grant execute on function public.promote_pre_subscribe_intakes_to_shipping() to authenticated;

comment on function public.promote_pre_subscribe_intakes_to_shipping() is
  'Sets pre_subscribe_eligible intakes to shipping for auth.uid() after subscription.';
