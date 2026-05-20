-- Persiste le point relais hub choisi au checkout (retour membre → centre logistique).

create or replace function public.confirm_cart_paid_from_stripe(
  p_cart_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_delivery_channel text,
  p_relay_point_id text,
  p_delivery_line1 text,
  p_return_relay_point_id text default null,
  p_return_relay_label text default null,
  p_return_relay_search_postal_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status public.cart_status;
  v_ship_id uuid;
  v_channel text := lower(coalesce(nullif(trim(p_delivery_channel), ''), 'relay'));
  v_dest_meta jsonb;
begin
  if p_cart_id is null or p_user_id is null then
    raise exception 'cart_id and user_id are required';
  end if;

  v_dest_meta := jsonb_build_object(
    'stripe_checkout_session_id', p_checkout_session_id,
    'source', 'stripe_cart_order'
  );
  if coalesce(nullif(trim(p_return_relay_point_id), ''), '') <> '' then
    v_dest_meta := v_dest_meta || jsonb_strip_nulls(
      jsonb_build_object(
        'return_relay_code', nullif(trim(p_return_relay_point_id), ''),
        'return_relay_label', nullif(trim(p_return_relay_label), ''),
        'return_relay_search_postal_code', nullif(trim(p_return_relay_search_postal_code), '')
      )
    );
  end if;

  select c.status
    into v_status
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'Cart not found';
  end if;

  if exists (
    select 1
    from public.carts c
    where c.id = p_cart_id
      and c.user_id is distinct from p_user_id
  ) then
    raise exception 'Forbidden: cart does not belong to user';
  end if;

  if v_status = 'confirmed'::public.cart_status then
    update public.cart_items ci
    set
      status = 'reserved'::public.cart_item_status,
      updated_at = now()
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null
      and ci.status in (
        'in_cart'::public.cart_item_status,
        'reservation_pending'::public.cart_item_status,
        'reserved'::public.cart_item_status
      );

    update public.items i
    set
      status = 'reserved'::public.item_status,
      updated_at = now()
    from public.cart_items ci
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null
      and ci.item_id = i.id
      and i.deleted_at is null
      and ci.status = 'reserved'::public.cart_item_status;

    if coalesce(nullif(trim(p_return_relay_point_id), ''), '') <> '' then
      update public.shipment_destinations sd
      set
        metadata = coalesce(sd.metadata, '{}'::jsonb) || jsonb_strip_nulls(
          jsonb_build_object(
            'return_relay_code', nullif(trim(p_return_relay_point_id), ''),
            'return_relay_label', nullif(trim(p_return_relay_label), ''),
            'return_relay_search_postal_code', nullif(trim(p_return_relay_search_postal_code), '')
          )
        ),
        updated_at = now()
      from public.shipments s
      where sd.shipment_id = s.id
        and s.cart_id = p_cart_id
        and s.context = 'cart_outbound'::public.shipment_context
        and s.deleted_at is null;
    end if;

    perform public.confirm_cart_try_monthly_orders_used_bump(p_cart_id, p_user_id);

    return jsonb_build_object(
      'ok', true,
      'already_confirmed', true,
      'cart_id', p_cart_id
    );
  end if;

  if v_status is distinct from 'checkout_pending'::public.cart_status
     and v_status is distinct from 'active'::public.cart_status then
    raise exception 'Cart cannot be confirmed from status: %', v_status;
  end if;

  delete from public.item_inventory_locks il
  where il.cart_id = p_cart_id;

  update public.carts c
  set
    status = 'confirmed'::public.cart_status,
    locked_until = null,
    updated_at = now()
  where c.id = p_cart_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    p_cart_id,
    v_status,
    'confirmed'::public.cart_status,
    'stripe_checkout_paid',
    p_user_id
  );

  update public.cart_items ci
  set
    status = 'reserved'::public.cart_item_status,
    updated_at = now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.status in (
      'in_cart'::public.cart_item_status,
      'reservation_pending'::public.cart_item_status,
      'reserved'::public.cart_item_status
    );

  update public.items i
  set
    status = 'reserved'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id
    and i.deleted_at is null
    and ci.status = 'reserved'::public.cart_item_status;

  if not exists (
    select 1
    from public.shipments s
    where s.cart_id = p_cart_id
      and s.context = 'cart_outbound'::public.shipment_context
      and s.deleted_at is null
  ) then
    insert into public.shipments (cart_id, context, status)
    values (p_cart_id, 'cart_outbound'::public.shipment_context, 'pending'::public.shipment_status)
    returning id into v_ship_id;

    insert into public.shipment_items (shipment_id, cart_item_id)
    select v_ship_id, ci.id
    from public.cart_items ci
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null;

    if v_channel = 'relay' and coalesce(nullif(trim(p_relay_point_id), ''), '') <> '' then
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        provider_point_id,
        metadata
      )
      values (
        v_ship_id,
        'pickup_point'::public.shipment_destination_type,
        nullif(trim(p_relay_point_id), ''),
        v_dest_meta
      );
    elsif v_channel = 'home' then
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        line1,
        metadata
      )
      values (
        v_ship_id,
        'home'::public.shipment_destination_type,
        coalesce(nullif(trim(p_delivery_line1), ''), 'Livraison à domicile (checkout)'),
        v_dest_meta
      );
    else
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        provider_point_id,
        metadata
      )
      values (
        v_ship_id,
        'pickup_point'::public.shipment_destination_type,
        null,
        v_dest_meta || jsonb_build_object('note', 'relay_point_missing')
      );
    end if;
  end if;

  perform public.log_activity_event_rpc(
    'cart_confirmed_stripe',
    'stripe_checkout_paid',
    p_user_id,
    'cart'::public.activity_resource_type,
    'cart',
    p_cart_id,
    'info'::public.activity_severity,
    jsonb_build_object(
      'cart_id', p_cart_id,
      'checkout_session_id', p_checkout_session_id,
      'delivery_channel', v_channel
    ),
    null
  );

  perform public.confirm_cart_try_monthly_orders_used_bump(p_cart_id, p_user_id);

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'shipment_id', v_ship_id
  );
end;
$fn$;

comment on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text, text, text, text) is
  'Payé sur Stripe : panier confirmé + shipment cart_outbound. '
  'Inclut return_relay_* (point relais hub retour choisi au checkout).';

revoke all on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text, text, text, text) to service_role;
