-- Phase « prêt à expédier » avant « en transit » : étiquette / portail / mutualisation retour.

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'item_intake_fulfillment_stage'
      and e.enumlabel = 'ready'
  ) then
    alter type public.item_intake_fulfillment_stage add value 'ready';
  end if;
end
$$;

comment on column public.item_intake.fulfillment_stage is
  'ready=étiquette ou mutualisation retour préparée ; shipping=en transit vers Segna ; in_verification=contrôle ; verified=OK catalogue.';

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

  -- Validation annonce : pas de passage auto en shipping (uniquement ready via expédition / mutualisation).
  if new.listing_stage::text = 'validated'
     and old.listing_stage::text = 'validation_pending'
     and new.fulfillment_stage is null
  then
    new.fulfillment_stage := null;
  end if;

  if new.fulfillment_stage::text = 'shipping'
     and coalesce(old.fulfillment_stage::text, '') is distinct from 'shipping'
  then
    new.metadata := public.item_intake_metadata_strip_shipping_labels(new.metadata);
  end if;

  return new;
end;
$$;
