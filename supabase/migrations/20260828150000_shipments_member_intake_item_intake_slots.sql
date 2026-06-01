-- member_intake : jusqu'à 5 pièces par colis (item_intake_1_id … item_intake_5_id).

alter table public.shipments
  add column if not exists item_intake_1_id uuid references public.item_intake (item_id) on delete set null,
  add column if not exists item_intake_2_id uuid references public.item_intake (item_id) on delete set null,
  add column if not exists item_intake_3_id uuid references public.item_intake (item_id) on delete set null,
  add column if not exists item_intake_4_id uuid references public.item_intake (item_id) on delete set null,
  add column if not exists item_intake_5_id uuid references public.item_intake (item_id) on delete set null;

comment on column public.shipments.item_intake_1_id is
  'Pièce intake #1 (obligatoire si member_intake actif). Lots fusionnés : ids triés, max 5.';
comment on column public.shipments.item_intake_2_id is 'Pièce intake #2 (lot fusionné, optionnel).';
comment on column public.shipments.item_intake_3_id is 'Pièce intake #3 (lot fusionné, optionnel).';
comment on column public.shipments.item_intake_4_id is 'Pièce intake #4 (lot fusionné, optionnel).';
comment on column public.shipments.item_intake_5_id is 'Pièce intake #5 (lot fusionné, optionnel).';

-- Reprise depuis l’ancienne colonne item_intake_id
update public.shipments s
set item_intake_1_id = s.item_intake_id
where s.context = 'member_intake'::public.shipment_context
  and s.item_intake_id is not null
  and s.item_intake_1_id is null;

-- Reprise depuis sc_intake_item_ids (destination)
update public.shipments s
set
  item_intake_1_id = coalesce(s.item_intake_1_id, sub.ids[1]),
  item_intake_2_id = coalesce(s.item_intake_2_id, sub.ids[2]),
  item_intake_3_id = coalesce(s.item_intake_3_id, sub.ids[3]),
  item_intake_4_id = coalesce(s.item_intake_4_id, sub.ids[4]),
  item_intake_5_id = coalesce(s.item_intake_5_id, sub.ids[5])
from (
  select
    sh.id as shipment_id,
    (
      select coalesce(array_agg(u.id order by u.id::text), '{}'::uuid[])
      from unnest(public._parse_csv_uuids(sd.metadata->>'sc_intake_item_ids')) as u(id)
    ) as ids
  from public.shipments sh
  join public.shipment_destinations sd on sd.shipment_id = sh.id
  where sh.context = 'member_intake'::public.shipment_context
    and sh.deleted_at is null
    and coalesce(btrim(sd.metadata->>'sc_intake_item_ids'), '') <> ''
) sub
where s.id = sub.shipment_id
  and coalesce(array_length(sub.ids, 1), 0) > 0;

-- Reprise depuis metadata sendcloud (pièces liées au shipment)
update public.shipments s
set
  item_intake_1_id = coalesce(s.item_intake_1_id, sub.ids[1]),
  item_intake_2_id = coalesce(s.item_intake_2_id, sub.ids[2]),
  item_intake_3_id = coalesce(s.item_intake_3_id, sub.ids[3]),
  item_intake_4_id = coalesce(s.item_intake_4_id, sub.ids[4]),
  item_intake_5_id = coalesce(s.item_intake_5_id, sub.ids[5])
from (
  select
    sh.id as shipment_id,
    (
      select coalesce(array_agg(ii.item_id order by ii.item_id::text), '{}'::uuid[])
      from public.item_intake ii
      where ii.metadata->'sendcloud'->>'sc_member_intake_shipment_id' = sh.id::text
    ) as ids
  from public.shipments sh
  where sh.context = 'member_intake'::public.shipment_context
    and sh.deleted_at is null
) sub
where s.id = sub.shipment_id
  and coalesce(array_length(sub.ids, 1), 0) > 0;

drop index if exists public.shipments_item_intake_id_active_idx;
drop index if exists public.shipments_member_intake_item_intake_active_uniq;

alter table public.shipments drop column if exists item_intake_id;

alter table public.shipments drop constraint if exists shipments_context_fk_check;

alter table public.shipments
  add constraint shipments_context_fk_check check (
    (
      context in ('cart_outbound'::public.shipment_context, 'cart_return'::public.shipment_context)
      and cart_id is not null
      and item_intake_1_id is null
      and item_intake_2_id is null
      and item_intake_3_id is null
      and item_intake_4_id is null
      and item_intake_5_id is null
    )
    or (
      context = 'member_intake'::public.shipment_context
      and cart_id is null
      and (
        deleted_at is not null
        or item_intake_1_id is not null
      )
    )
    or (
      context not in (
        'cart_outbound'::public.shipment_context,
        'cart_return'::public.shipment_context,
        'member_intake'::public.shipment_context
      )
    )
  );

alter table public.shipments drop constraint if exists shipments_member_intake_slots_check;

alter table public.shipments
  add constraint shipments_member_intake_slots_check check (
    context is distinct from 'member_intake'::public.shipment_context
    or (
      (item_intake_2_id is null or item_intake_1_id is not null)
      and (item_intake_3_id is null or item_intake_2_id is not null)
      and (item_intake_4_id is null or item_intake_3_id is not null)
      and (item_intake_5_id is null or item_intake_4_id is not null)
    )
  );

comment on constraint shipments_context_fk_check on public.shipments is
  'cart_* exige cart_id ; member_intake actif exige item_intake_1_id ; slots 2–5 pour fusion (max 5 pièces).';

create index if not exists shipments_member_intake_slot1_active_idx
  on public.shipments (item_intake_1_id)
  where item_intake_1_id is not null
    and deleted_at is null
    and context = 'member_intake'::public.shipment_context;

create unique index if not exists shipments_member_intake_slot1_active_uniq
  on public.shipments (item_intake_1_id)
  where context = 'member_intake'::public.shipment_context
    and deleted_at is null
    and item_intake_1_id is not null;

create unique index if not exists shipments_member_intake_slot2_active_uniq
  on public.shipments (item_intake_2_id)
  where context = 'member_intake'::public.shipment_context
    and deleted_at is null
    and item_intake_2_id is not null;

create unique index if not exists shipments_member_intake_slot3_active_uniq
  on public.shipments (item_intake_3_id)
  where context = 'member_intake'::public.shipment_context
    and deleted_at is null
    and item_intake_3_id is not null;

create unique index if not exists shipments_member_intake_slot4_active_uniq
  on public.shipments (item_intake_4_id)
  where context = 'member_intake'::public.shipment_context
    and deleted_at is null
    and item_intake_4_id is not null;

create unique index if not exists shipments_member_intake_slot5_active_uniq
  on public.shipments (item_intake_5_id)
  where context = 'member_intake'::public.shipment_context
    and deleted_at is null
    and item_intake_5_id is not null;

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
        s.item_intake_2_id,
        s.item_intake_3_id,
        s.item_intake_4_id,
        s.item_intake_5_id
      ],
      null::uuid
    ),
    '{}'::uuid[]
  )
  from public.shipments s
  where s.id = p_shipment_id;
$$;

comment on function public.member_intake_item_ids_from_shipment(uuid) is
  'Liste ordonnée des item_intake liés à un shipment member_intake (slots 1–5).';

create or replace function public.promote_member_intake_items_to_shipping(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sid text := p_shipment_id::text;
  v_dest_csv text;
  v_item_id uuid;
  v_slot_ids uuid[] := '{}';
  v_ids uuid[] := '{}';
  v_part text;
begin
  if p_shipment_id is null then
    return;
  end if;

  select public.member_intake_item_ids_from_shipment(p_shipment_id)
    into v_slot_ids;

  select coalesce(array_agg(distinct ii.item_id), '{}')
    into v_ids
  from public.item_intake ii
  where ii.metadata->'sendcloud'->>'sc_member_intake_shipment_id' = v_sid
     or ii.metadata->'sendcloud'->>'sc_dummy_shipment_id' = v_sid
     or (coalesce(array_length(v_slot_ids, 1), 0) > 0 and ii.item_id = any (v_slot_ids));

  select sd.metadata->>'sc_intake_item_ids'
    into v_dest_csv
  from public.shipment_destinations sd
  where sd.shipment_id = p_shipment_id
  limit 1;

  if v_dest_csv is not null and btrim(v_dest_csv) <> '' then
    foreach v_part in array string_to_array(v_dest_csv, ',') loop
      v_part := btrim(v_part);
      if v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_item_id := v_part::uuid;
        if not (v_item_id = any (v_ids)) then
          v_ids := array_append(v_ids, v_item_id);
        end if;
      end if;
    end loop;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return;
  end if;

  update public.item_intake ii
  set fulfillment_stage = 'shipping'::public.item_intake_fulfillment_stage
  where ii.item_id = any (v_ids)
    and ii.listing_stage::text = 'validated'
    and ii.fulfillment_stage::text = 'ready';
end;
$fn$;
