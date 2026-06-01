-- member_intake : max 2 pièces par colis (suppression slots 3–5).

-- Archive les shipments actifs qui utilisaient encore les slots 3–5.
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
    s.item_intake_3_id is not null
    or s.item_intake_4_id is not null
    or s.item_intake_5_id is not null
  );

drop index if exists public.shipments_member_intake_slot3_active_uniq;
drop index if exists public.shipments_member_intake_slot4_active_uniq;
drop index if exists public.shipments_member_intake_slot5_active_uniq;

alter table public.shipments drop constraint if exists shipments_member_intake_slots_check;

alter table public.shipments
  add constraint shipments_member_intake_slots_check check (
    context is distinct from 'member_intake'::public.shipment_context
    or deleted_at is not null
    or (item_intake_2_id is null or item_intake_1_id is not null)
  );

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
    updated_at = now()
  where s.context = 'member_intake'::public.shipment_context
    and s.deleted_at is null
    and (
      s.item_intake_1_id = old.item_id
      or s.item_intake_2_id = old.item_id
    );
  return old;
end;
$$;

create or replace function public.member_intake_item_ids_from_shipment(p_shipment_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_remove(
      array[
        s.item_intake_1_id,
        s.item_intake_2_id
      ],
      null::uuid
    ),
    '{}'::uuid[]
  )
  from public.shipments s
  where s.id = p_shipment_id;
$$;

comment on function public.member_intake_item_ids_from_shipment(uuid) is
  'Liste ordonnée des item_intake liés à un shipment member_intake (slots 1–2).';

alter table public.shipments
  drop column if exists item_intake_3_id,
  drop column if exists item_intake_4_id,
  drop column if exists item_intake_5_id;
