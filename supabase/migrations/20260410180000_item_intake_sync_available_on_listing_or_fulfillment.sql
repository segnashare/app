-- items.status doit passer à available dès que item_intake a listing_stage = validated ET fulfillment_stage = verified,
-- quel que soit l’ordre des mises à jour (l’ancien trigger ne surveillait que fulfillment_stage, donc si verified
-- arrivait avant validated, le passage listing → validated ne relançait pas la synchro).

create or replace function public.item_intake_after_update_sync_items_listed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_stage::text = 'verified' and new.listing_stage::text = 'validated' then
    if tg_op = 'INSERT' then
      update public.items
      set
        status = 'available'::public.item_status,
        updated_at = now()
      where id = new.item_id
        and deleted_at is null
        and status not in ('in_cart'::public.item_status, 'reserved'::public.item_status);
    elsif tg_op = 'UPDATE' then
      if not (
        old.fulfillment_stage::text = 'verified'
        and old.listing_stage::text = 'validated'
      ) then
        update public.items
        set
          status = 'available'::public.item_status,
          updated_at = now()
        where id = new.item_id
          and deleted_at is null
          and status not in ('in_cart'::public.item_status, 'reserved'::public.item_status);
      end if;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.item_intake_after_update_sync_items_listed() is
  'Quand intake atteint validated + verified (via listing et/ou fulfillment), items.status = available.';

drop trigger if exists trg_item_intake_after_update_sync_listed on public.item_intake;

create trigger trg_item_intake_after_update_sync_listed
after insert or update of fulfillment_stage, listing_stage on public.item_intake
for each row
execute function public.item_intake_after_update_sync_items_listed();

-- Données déjà cohérentes intake mais items encore listed (y compris ordre d’update historique).
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
