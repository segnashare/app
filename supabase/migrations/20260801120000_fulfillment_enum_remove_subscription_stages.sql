-- Supprime les valeurs d'enum `awaiting_subscription` et `pre_subscribe_eligible` :
-- une annonce validée passe directement en expédition (`shipping`), sans condition d'abonnement prêteur.

-- 1) Données courantes
update public.item_intake
set
  fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage,
  updated_at = now()
where fulfillment_stage::text in ('awaiting_subscription', 'pre_subscribe_eligible');

update public.item_status_history
set
  from_fulfillment_stage = case
    when from_fulfillment_stage::text in ('awaiting_subscription', 'pre_subscribe_eligible')
      then 'shipping'::public.item_intake_fulfillment_stage
    else from_fulfillment_stage
  end,
  to_fulfillment_stage = case
    when to_fulfillment_stage::text in ('awaiting_subscription', 'pre_subscribe_eligible')
      then 'shipping'::public.item_intake_fulfillment_stage
    else to_fulfillment_stage
  end
where coalesce(from_fulfillment_stage::text, '') in ('awaiting_subscription', 'pre_subscribe_eligible')
   or coalesce(to_fulfillment_stage::text, '') in ('awaiting_subscription', 'pre_subscribe_eligible');

-- 2) Triggers sur item_intake (PG refuse ALTER TYPE si une définition de trigger référence la colonne)
do $$
declare
  r record;
begin
  for r in (
    select t.tgname
    from pg_trigger t
    join pg_class c on t.tgrelid = c.oid
    join pg_namespace n on c.relnamespace = n.oid
    where n.nspname = 'public'
      and c.relname = 'item_intake'
      and not t.tgisinternal
  ) loop
    execute format('drop trigger if exists %I on public.item_intake', r.tgname);
  end loop;
end;
$$;

drop function if exists public.item_intake_before_update_member_fulfillment_guard() cascade;

-- RPC historique : ne plus filtrer sur les anciens stades (compat appels Stripe / client)
create or replace function public._apply_promote_pending_lender_intakes_to_shipping(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return 0;
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
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  perform public._apply_promote_pending_lender_intakes_to_shipping(v_uid);
  return jsonb_build_object('ok', true, 'updated', 0);
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
begin
  if v_role is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user');
  end if;
  perform public._apply_promote_pending_lender_intakes_to_shipping(p_user_id);
  return jsonb_build_object('ok', true, 'updated', 0);
end;
$$;

revoke all on function public.promote_pre_subscribe_intakes_to_shipping() from public;
grant execute on function public.promote_pre_subscribe_intakes_to_shipping() to authenticated;

revoke all on function public.promote_pre_subscribe_intakes_to_shipping_for_user(uuid) from public;
grant execute on function public.promote_pre_subscribe_intakes_to_shipping_for_user(uuid) to service_role;

comment on function public.promote_pre_subscribe_intakes_to_shipping() is
  'Historique : plus de promotion liée à l’abonnement ; renvoie ok sans mise à jour.';

comment on function public.promote_pre_subscribe_intakes_to_shipping_for_user(uuid) is
  'Historique : service_role / webhooks ; renvoie ok sans mise à jour.';

-- 3) Nouvel enum sans les stades abonnement
create type public.item_intake_fulfillment_stage_new as enum (
  'shipping',
  'in_verification',
  'verified',
  'refused'
);

alter table public.item_intake
  alter column fulfillment_stage
    type public.item_intake_fulfillment_stage_new
    using (
      case
        when fulfillment_stage is null then null::public.item_intake_fulfillment_stage_new
        when fulfillment_stage::text = 'shipping' then 'shipping'::public.item_intake_fulfillment_stage_new
        when fulfillment_stage::text = 'in_verification' then 'in_verification'::public.item_intake_fulfillment_stage_new
        when fulfillment_stage::text = 'verified' then 'verified'::public.item_intake_fulfillment_stage_new
        when fulfillment_stage::text = 'refused' then 'refused'::public.item_intake_fulfillment_stage_new
        when fulfillment_stage::text in ('awaiting_subscription', 'pre_subscribe_eligible')
          then 'shipping'::public.item_intake_fulfillment_stage_new
        else 'shipping'::public.item_intake_fulfillment_stage_new
      end
    );

alter table public.item_status_history
  alter column from_fulfillment_stage
    type public.item_intake_fulfillment_stage_new
    using (
      case
        when from_fulfillment_stage is null then null::public.item_intake_fulfillment_stage_new
        when from_fulfillment_stage::text = 'shipping' then 'shipping'::public.item_intake_fulfillment_stage_new
        when from_fulfillment_stage::text = 'in_verification' then 'in_verification'::public.item_intake_fulfillment_stage_new
        when from_fulfillment_stage::text = 'verified' then 'verified'::public.item_intake_fulfillment_stage_new
        when from_fulfillment_stage::text = 'refused' then 'refused'::public.item_intake_fulfillment_stage_new
        when from_fulfillment_stage::text in ('awaiting_subscription', 'pre_subscribe_eligible')
          then 'shipping'::public.item_intake_fulfillment_stage_new
        else 'shipping'::public.item_intake_fulfillment_stage_new
      end
    );

alter table public.item_status_history
  alter column to_fulfillment_stage
    type public.item_intake_fulfillment_stage_new
    using (
      case
        when to_fulfillment_stage is null then null::public.item_intake_fulfillment_stage_new
        when to_fulfillment_stage::text = 'shipping' then 'shipping'::public.item_intake_fulfillment_stage_new
        when to_fulfillment_stage::text = 'in_verification' then 'in_verification'::public.item_intake_fulfillment_stage_new
        when to_fulfillment_stage::text = 'verified' then 'verified'::public.item_intake_fulfillment_stage_new
        when to_fulfillment_stage::text = 'refused' then 'refused'::public.item_intake_fulfillment_stage_new
        when to_fulfillment_stage::text in ('awaiting_subscription', 'pre_subscribe_eligible')
          then 'shipping'::public.item_intake_fulfillment_stage_new
        else 'shipping'::public.item_intake_fulfillment_stage_new
      end
    );

drop type public.item_intake_fulfillment_stage;

alter type public.item_intake_fulfillment_stage_new rename to item_intake_fulfillment_stage;

comment on column public.item_intake.fulfillment_stage is
  'shipping | in_verification | verified | refused — expédition dès validation annonce (sans étape abonnement).';

-- 4) Trigger : validation membre -> fulfillment shipping
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
    new.fulfillment_stage := 'shipping'::public.item_intake_fulfillment_stage;
  end if;

  return new;
end;
$$;

create trigger item_intake_set_updated_at
before update on public.item_intake
for each row
execute function public.set_updated_at();

create trigger trg_item_intake_touch_evaluation_started_at
before insert or update of listing_stage on public.item_intake
for each row
execute function public.item_intake_touch_evaluation_started_at();

create trigger trg_item_intake_before_insert_guard
before insert on public.item_intake
for each row
execute function public.item_intake_before_insert_member_fulfillment_guard();

create trigger trg_item_intake_before_update_guard
before update on public.item_intake
for each row
execute function public.item_intake_before_update_member_fulfillment_guard();

create trigger trg_item_intake_edge_evaluation_webhook
after insert or update of listing_stage on public.item_intake
for each row
execute function public._trg_notify_item_intake_edge_evaluation();

create trigger trg_item_intake_after_update_sync_listed
after insert or update of fulfillment_stage, listing_stage on public.item_intake
for each row
execute function public.item_intake_after_update_sync_items_listed();

create trigger trg_item_intake_after_verified_wallet_credit
after insert or update of fulfillment_stage, listing_stage on public.item_intake
for each row
execute function public.item_intake_after_verified_wallet_credit();

create trigger trg_item_intake_after_refusal_workflow
after insert or update of listing_stage, fulfillment_stage on public.item_intake
for each row
execute function public.item_intake_after_refusal_workflow();

create trigger trg_item_intake_after_update_log_pipeline_history
after update on public.item_intake
for each row
execute function public.item_intake_after_update_log_pipeline_history();
