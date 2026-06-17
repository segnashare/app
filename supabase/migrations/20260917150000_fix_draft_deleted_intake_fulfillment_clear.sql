-- Suppression membre (items → draft_deleted) : le trigger sync remet fulfillment_stage à NULL
-- sur item_intake, mais le guard membre bloque toute mutation de fulfillment_stage pour
-- le rôle authenticated → erreur « mise a jour reservee au service role ».

create or replace function public.item_intake_before_update_member_fulfillment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('segna.internal_intake_fulfillment_update', true), '') <> '1'
     and coalesce((select auth.jwt()) ->> 'role', '') = 'authenticated'
     and new.fulfillment_stage is distinct from old.fulfillment_stage
  then
    raise exception 'item_intake.fulfillment_stage: mise a jour reservee au service role';
  end if;

  if new.listing_stage::text = 'validated'
     and old.listing_stage::text = 'validation_pending'
     and new.fulfillment_stage is null
  then
    new.fulfillment_stage := 'ready'::public.item_intake_fulfillment_stage;
  end if;

  if new.fulfillment_stage::text = 'shipping'
     and coalesce(old.fulfillment_stage::text, '') is distinct from 'shipping'
  then
    new.metadata := public.item_intake_metadata_strip_shipping_labels(new.metadata);
  end if;

  return new;
end;
$$;

create or replace function public.items_after_update_sync_item_intake_on_draft_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'draft_deleted'::public.item_status then
    perform set_config('segna.internal_intake_fulfillment_update', '1', true);
    update public.item_intake
    set
      deleted_at = coalesce(new.deleted_at, now()),
      fulfillment_stage = null,
      listing_stage = 'draft'::public.item_intake_listing_stage,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('legacy_items_status', 'draft_deleted'),
      updated_at = now()
    where item_id = new.id;
    perform set_config('segna.internal_intake_fulfillment_update', '', true);
  elsif old.status = 'draft_deleted'::public.item_status
        and new.status = 'draft'::public.item_status
        and new.deleted_at is null
  then
    update public.item_intake
    set
      deleted_at = null,
      updated_at = now()
    where item_id = new.id;
  end if;
  return new;
end;
$$;

comment on function public.items_after_update_sync_item_intake_on_draft_deleted() is
  'draft_deleted sur items : sync item_intake (deleted_at, reset pipeline). Bypass guard fulfillment via set_config transaction-local.';
