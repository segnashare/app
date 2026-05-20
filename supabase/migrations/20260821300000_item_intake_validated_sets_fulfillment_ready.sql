-- Rétablit le passage en `ready` quand le membre accepte l’offre (validation_pending → validated).
-- La migration 20260821220000 laissait fulfillment_stage à NULL → plus de carte « Préparer ton envoi ».

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

comment on function public.item_intake_before_update_member_fulfillment_guard() is
  'validation_pending → validated : fulfillment ready (bordereau) ; shipping : nettoyage metadata étiquette.';

update public.item_intake ii
set
  fulfillment_stage = 'ready'::public.item_intake_fulfillment_stage,
  updated_at = now()
where ii.deleted_at is null
  and ii.listing_stage = 'validated'::public.item_intake_listing_stage
  and ii.fulfillment_stage is null;
