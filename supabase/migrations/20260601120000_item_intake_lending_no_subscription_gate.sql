-- Prêt catalogue : plus de passage par `awaiting_subscription` (expédition dès validation membre,
-- sauf parcours « proposition avant abonnement » = pre_subscribe_eligible).
-- Réaligne le trigger (bases partiellement migrées) et nettoie les lignes restantes.

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
  'shipping / in_verification / verified / refused / pre_subscribe_eligible (proposition). awaiting_subscription : valeur historique, ne plus assigner pour le catalogue.';

update public.item_intake ii
set
  fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage,
  updated_at = now()
where ii.deleted_at is null
  and ii.listing_stage = 'validated'::public.item_intake_listing_stage
  and ii.fulfillment_stage = 'awaiting_subscription'::public.item_intake_fulfillment_stage
  and coalesce(ii.metadata ->> 'intake_path', '') is distinct from 'pre_subscribe_proposal';
