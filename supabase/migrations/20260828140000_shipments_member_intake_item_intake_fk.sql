-- member_intake : lien structuré shipments → item_intake (comme cart_id pour cart_outbound / cart_return).

alter table public.shipments
  add column if not exists item_intake_id uuid references public.item_intake (item_id) on delete set null;

comment on column public.shipments.item_intake_id is
  'Pièce intake liée (PK item_intake). Obligatoire pour context member_intake actif ; pièce principale d''un lot groupé.';

create index if not exists shipments_item_intake_id_active_idx
  on public.shipments (item_intake_id)
  where item_intake_id is not null
    and deleted_at is null
    and context = 'member_intake'::public.shipment_context;

-- Rattrapage : metadata sendcloud → shipment
update public.shipments s
set item_intake_id = sub.item_id
from (
  select distinct on (s.id) s.id as shipment_id, ii.item_id
  from public.shipments s
  join public.item_intake ii
    on ii.metadata->'sendcloud'->>'sc_member_intake_shipment_id' = s.id::text
  where s.context = 'member_intake'::public.shipment_context
    and s.deleted_at is null
    and s.item_intake_id is null
  order by s.id, ii.item_id
) sub
where s.id = sub.shipment_id;

-- Rattrapage : destination sc_intake_item_ids (pièce principale = plus petit UUID du lot)
update public.shipments s
set item_intake_id = sub.primary_item_id
from (
  select
    sd.shipment_id,
    (
      select u.id
      from unnest(public._parse_csv_uuids(sd.metadata->>'sc_intake_item_ids')) as u(id)
      order by u.id::text asc
      limit 1
    ) as primary_item_id
  from public.shipment_destinations sd
  join public.shipments sh on sh.id = sd.shipment_id
  where sh.context = 'member_intake'::public.shipment_context
    and sh.deleted_at is null
    and sh.item_intake_id is null
    and coalesce(btrim(sd.metadata->>'sc_intake_item_ids'), '') <> ''
) sub
where s.id = sub.shipment_id
  and sub.primary_item_id is not null;

alter table public.shipments drop constraint if exists shipments_cart_context_check;

alter table public.shipments
  add constraint shipments_context_fk_check check (
    (
      context in ('cart_outbound'::public.shipment_context, 'cart_return'::public.shipment_context)
      and cart_id is not null
      and item_intake_id is null
    )
    or (
      context = 'member_intake'::public.shipment_context
      and cart_id is null
      and (
        deleted_at is not null
        or item_intake_id is not null
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

comment on constraint shipments_context_fk_check on public.shipments is
  'cart_* exige cart_id ; member_intake actif exige item_intake_id ; autres contextes sans contrainte FK métier.';

create unique index if not exists shipments_member_intake_item_intake_active_uniq
  on public.shipments (item_intake_id)
  where context = 'member_intake'::public.shipment_context
    and deleted_at is null
    and item_intake_id is not null;

-- promote_member_intake_items_to_shipping : inclure la FK item_intake_id
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
  v_primary_item_id uuid;
  v_ids uuid[] := '{}';
  v_part text;
begin
  if p_shipment_id is null then
    return;
  end if;

  select s.item_intake_id
    into v_primary_item_id
  from public.shipments s
  where s.id = p_shipment_id
    and s.deleted_at is null;

  select coalesce(array_agg(distinct ii.item_id), '{}')
    into v_ids
  from public.item_intake ii
  where ii.metadata->'sendcloud'->>'sc_member_intake_shipment_id' = v_sid
     or ii.metadata->'sendcloud'->>'sc_dummy_shipment_id' = v_sid;

  if v_primary_item_id is not null and not (v_primary_item_id = any (v_ids)) then
    v_ids := array_append(v_ids, v_primary_item_id);
  end if;

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
