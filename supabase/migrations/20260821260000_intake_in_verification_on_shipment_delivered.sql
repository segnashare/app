-- member_intake ou retour mutualisé (cart_return + pending_intake) → delivered / returned :
-- item_intake.fulfillment_stage passe à in_verification (réception Segna).

create or replace function public._parse_csv_uuids(p_csv text)
returns uuid[]
language plpgsql
immutable
as $fn$
declare
  v_ids uuid[] := '{}';
  v_part text;
begin
  if p_csv is null or btrim(p_csv) = '' then
    return v_ids;
  end if;
  foreach v_part in array string_to_array(p_csv, ',') loop
    v_part := btrim(v_part);
    if v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      if not (v_part::uuid = any (v_ids)) then
        v_ids := array_append(v_ids, v_part::uuid);
      end if;
    end if;
  end loop;
  return v_ids;
end;
$fn$;

create or replace function public.promote_intake_items_to_in_verification_on_shipment_delivered(
  p_shipment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sid text := p_shipment_id::text;
  v_context text;
  v_dest_csv text;
  v_pending_csv text;
  v_ids uuid[] := '{}';
  v_meta_ids uuid[] := '{}';
begin
  if p_shipment_id is null then
    return;
  end if;

  select s.context::text into v_context
  from public.shipments s
  where s.id = p_shipment_id
    and s.deleted_at is null;

  if v_context is null then
    return;
  end if;

  if v_context = 'member_intake' then
    select coalesce(array_agg(distinct ii.item_id), '{}')
      into v_meta_ids
    from public.item_intake ii
    where ii.metadata->'sendcloud'->>'sc_member_intake_shipment_id' = v_sid
       or ii.metadata->'sendcloud'->>'sc_dummy_shipment_id' = v_sid;

    select sd.metadata->>'sc_intake_item_ids'
      into v_dest_csv
    from public.shipment_destinations sd
    where sd.shipment_id = p_shipment_id
    limit 1;

    v_ids := v_meta_ids || public._parse_csv_uuids(v_dest_csv);

    update public.item_intake ii
    set fulfillment_stage = 'in_verification'::public.item_intake_fulfillment_stage
    where ii.item_id = any (v_ids)
      and ii.listing_stage::text = 'validated'
      and ii.fulfillment_stage::text = 'shipping'
      and (
        ii.metadata->'sendcloud'->>'sc_member_intake_shipment_id' = v_sid
        or ii.metadata->'sendcloud'->>'sc_dummy_shipment_id' = v_sid
        or ii.item_id = any (public._parse_csv_uuids(v_dest_csv))
      );

  elsif v_context = 'cart_return' then
    select sd.metadata->>'pending_intake_item_ids'
      into v_pending_csv
    from public.shipment_destinations sd
    where sd.shipment_id = p_shipment_id
    limit 1;

    select coalesce(array_agg(distinct ii.item_id), '{}')
      into v_meta_ids
    from public.item_intake ii
    where ii.metadata->'sendcloud'->>'sc_piggyback_shipment_id' = v_sid
       and ii.metadata->'sendcloud'->>'sc_shipping_mode' = 'cart_return_piggyback'
       and coalesce(ii.metadata->'sendcloud'->>'sc_piggyback_confirmed_at', '') <> '';

    v_ids := public._parse_csv_uuids(v_pending_csv) || v_meta_ids;

    update public.item_intake ii
    set fulfillment_stage = 'in_verification'::public.item_intake_fulfillment_stage
    where ii.item_id = any (v_ids)
      and ii.listing_stage::text = 'validated'
      and ii.fulfillment_stage::text = 'shipping'
      and ii.metadata->'sendcloud'->>'sc_shipping_mode' = 'cart_return_piggyback'
      and coalesce(ii.metadata->'sendcloud'->>'sc_piggyback_confirmed_at', '') <> ''
      and (
        ii.metadata->'sendcloud'->>'sc_piggyback_shipment_id' = v_sid
        or ii.item_id = any (public._parse_csv_uuids(v_pending_csv))
      );
  end if;
end;
$fn$;

comment on function public.promote_intake_items_to_in_verification_on_shipment_delivered(uuid) is
  'Réception colis (delivered/returned) : intake validated en shipping → in_verification (member_intake ou retour mutualisé).';

create or replace function public.transition_shipment_status(
  p_shipment_id uuid,
  p_if_current_status public.shipment_status,
  p_to_status public.shipment_status,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_source text default 'system',
  p_context jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_set_ready_at boolean default true,
  p_tracking_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_ts timestamptz := coalesce(p_occurred_at, timezone('utc', now()));
  v_n int;
  v_hid uuid;
  v_cart_id uuid;
  v_user_id uuid;
  v_context text;
  v_delivered_at timestamptz;
begin
  if p_shipment_id is null then
    return jsonb_build_object('ok', false, 'error', 'p_shipment_id is required');
  end if;
  if p_to_status is null then
    return jsonb_build_object('ok', false, 'error', 'p_to_status is required');
  end if;
  if p_if_current_status is not distinct from p_to_status then
    return jsonb_build_object('ok', false, 'error', 'NO_STATUS_CHANGE');
  end if;

  update public.shipments s
  set
    status = p_to_status,
    updated_at = v_ts,
    tracking_number = case
      when p_tracking_number is not null and length(trim(p_tracking_number)) > 0 then trim(p_tracking_number)
      else s.tracking_number
    end,
    ready_at = case
      when coalesce(p_set_ready_at, true)
        and p_to_status = 'ready'::public.shipment_status
        and s.ready_at is null then v_ts
      else s.ready_at
    end,
    delivered_at = case
      when p_to_status = 'delivered'::public.shipment_status and s.delivered_at is null then v_ts
      else s.delivered_at
    end
  where s.id = p_shipment_id
    and s.deleted_at is null
    and s.status = p_if_current_status;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'STATUS_MISMATCH');
  end if;

  if p_to_status = 'delivered'::public.shipment_status then
    select s.cart_id, s.context::text, s.delivered_at
      into v_cart_id, v_context, v_delivered_at
    from public.shipments s
    where s.id = p_shipment_id;

    if v_cart_id is not null and v_context = 'cart_outbound' and v_delivered_at is not null then
      select c.user_id into v_user_id
      from public.carts c
      where c.id = v_cart_id
        and c.deleted_at is null;

      if v_user_id is not null then
        update public.carts c
        set
          borrow_return_due_at = public.compute_borrow_return_due_at_from_delivery(v_delivered_at, v_user_id),
          updated_at = v_ts
        where c.id = v_cart_id
          and c.borrow_return_due_at is null;
      end if;
    end if;
  end if;

  if p_to_status in (
    'delivered'::public.shipment_status,
    'returned'::public.shipment_status
  ) then
    select s.context::text into v_context
    from public.shipments s
    where s.id = p_shipment_id;

    if v_context in ('member_intake', 'cart_return') then
      perform public.promote_intake_items_to_in_verification_on_shipment_delivered(p_shipment_id);
    end if;
  end if;

  select public.append_shipment_status_history(
    p_shipment_id := p_shipment_id,
    p_to_status := p_to_status,
    p_from_status := p_if_current_status,
    p_actor_user_id := p_actor_user_id,
    p_reason := p_reason,
    p_source := p_source,
    p_context := p_context,
    p_occurred_at := v_ts
  )
  into v_hid;

  return jsonb_build_object('ok', true, 'history_id', v_hid);
end;
$fn$;

comment on function public.transition_shipment_status(
  uuid,
  public.shipment_status,
  public.shipment_status,
  uuid,
  text,
  text,
  jsonb,
  timestamptz,
  boolean,
  text
) is
  'Met à jour shipments.status ; borrow_return_due_at (aller delivered) ; intake in_verification (member_intake / retour mutualisé delivered|returned) ; historique.';

-- Rattrapage : colis déjà reçus, pièces encore en shipping.
select public.promote_intake_items_to_in_verification_on_shipment_delivered(s.id)
from public.shipments s
where s.deleted_at is null
  and s.context in ('member_intake'::public.shipment_context, 'cart_return'::public.shipment_context)
  and lower(s.status::text) in ('delivered', 'returned');
