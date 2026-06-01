-- Suppression item_intake : les FK ON DELETE SET NULL sur item_intake_*_id laissaient
-- un member_intake actif sans slot 1 → violation shipments_context_fk_check.
-- On archive (soft-delete) + vide les slots AVANT la suppression de la pièce.

create or replace function public.archive_member_intake_shipments_on_item_intake_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shipments s
  set
    deleted_at = coalesce(s.deleted_at, now()),
    tracking_number = null,
    member_tracking_url = null,
    item_intake_1_id = null,
    item_intake_2_id = null,
    item_intake_3_id = null,
    item_intake_4_id = null,
    item_intake_5_id = null,
    updated_at = now()
  where s.context = 'member_intake'::public.shipment_context
    and s.deleted_at is null
    and (
      s.item_intake_1_id = old.item_id
      or s.item_intake_2_id = old.item_id
      or s.item_intake_3_id = old.item_id
      or s.item_intake_4_id = old.item_id
      or s.item_intake_5_id = old.item_id
    );
  return old;
end;
$$;

comment on function public.archive_member_intake_shipments_on_item_intake_delete() is
  'Avant DELETE item_intake : archive les shipments member_intake actifs qui référencent la pièce (évite violation context_fk / slots).';

drop trigger if exists archive_member_intake_shipments_before_item_intake_delete on public.item_intake;

create trigger archive_member_intake_shipments_before_item_intake_delete
  before delete on public.item_intake
  for each row
  execute function public.archive_member_intake_shipments_on_item_intake_delete();

-- Lots archivés : pas de contrainte « pas de trou » sur les slots (tous null autorisés).
alter table public.shipments drop constraint if exists shipments_member_intake_slots_check;

alter table public.shipments
  add constraint shipments_member_intake_slots_check check (
    context is distinct from 'member_intake'::public.shipment_context
    or deleted_at is not null
    or (
      (item_intake_2_id is null or item_intake_1_id is not null)
      and (item_intake_3_id is null or item_intake_2_id is not null)
      and (item_intake_4_id is null or item_intake_3_id is not null)
      and (item_intake_5_id is null or item_intake_4_id is not null)
    )
  );
