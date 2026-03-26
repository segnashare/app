-- Publication post-contrôle physique : items.status = available (pas listed).
-- Le statut métier « vérifiée physiquement » reste item_intake.fulfillment_stage = verified (affichage client).

create or replace function public.item_intake_after_update_sync_items_listed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_stage::text = 'verified' and new.listing_stage::text = 'validated' then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.fulfillment_stage is distinct from new.fulfillment_stage) then
      update public.items
      set
        status = 'available'::public.item_status,
        updated_at = now()
      where id = new.item_id
        and deleted_at is null
        and status not in ('in_cart'::public.item_status, 'reserved'::public.item_status);
    end if;
  end if;
  return new;
end;
$$;

comment on function public.item_intake_after_update_sync_items_listed() is
  'Quand fulfillment passe a verified (listing validated), publie la piece avec items.status = available.';

comment on column public.item_intake.fulfillment_stage is
  'shipping=en transit vers Segna ; in_verification=controle physique ; verified=OK physique -> items.status available (trigger) ; distingo UI via cette colonne.';

-- Données déjà verified mais encore en listed (anciennes exécutions du trigger).
update public.items i
set
  status = 'available'::public.item_status,
  updated_at = now()
from public.item_intake ii
where ii.item_id = i.id
  and ii.listing_stage = 'validated'::public.item_intake_listing_stage
  and ii.fulfillment_stage = 'verified'::public.item_intake_fulfillment_stage
  and i.deleted_at is null
  and i.status = 'listed'::public.item_status;
