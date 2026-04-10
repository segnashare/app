-- 1) Débit panier : créer user_wallets si absent (évite "Wallet not found" alors que l’UI affiche un solde ailleurs).
-- 2) Confirmation panier : log via log_activity_event_rpc (service_role) au lieu de log_activity_event (auth.uid() souvent null).

create or replace function public.wallet_debit_cart_order_stripe(
  p_user_id uuid,
  p_cart_id uuid,
  p_checkout_session_id text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_amount bigint;
  v_wallet_id uuid;
  v_balance bigint;
  v_tx_id uuid;
  v_meta jsonb;
  v_key text;
begin
  if p_user_id is null or p_cart_id is null then
    raise exception 'user_id and cart_id are required';
  end if;

  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    raise exception 'p_idempotency_key is required';
  end if;

  if exists (
    select 1
    from public.carts c
    where c.id = p_cart_id
      and c.deleted_at is null
      and c.user_id is distinct from p_user_id
  ) then
    raise exception 'Forbidden: cart does not belong to user';
  end if;

  select coalesce(sum(coalesce(i.price_points, 0)), 0)::bigint
    into v_amount
  from public.cart_items ci
  join public.items i on i.id = ci.item_id
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and i.deleted_at is null;

  if v_amount <= 0 then
    return jsonb_build_object(
      'applied', false,
      'skipped', true,
      'reason', 'zero_cart_exchange_points',
      'cart_id', p_cart_id
    );
  end if;

  if not exists (
    select 1
    from public.user_wallets uw
    where uw.user_id = p_user_id
      and uw.deleted_at is null
  ) then
    insert into public.user_wallets (user_id, balance_points)
    values (p_user_id, 0);
  end if;

  select uw.id, uw.balance_points
    into v_wallet_id, v_balance
  from public.user_wallets uw
  where uw.user_id = p_user_id
    and uw.deleted_at is null
  order by uw.updated_at desc
  limit 1
  for update;

  if v_wallet_id is null then
    raise exception 'Wallet not found for user';
  end if;

  if exists (
    select 1
    from public.wallet_transactions wt
    where wt.idempotency_key = v_key
  ) then
    select uw.balance_points
      into v_balance
    from public.user_wallets uw
    where uw.id = v_wallet_id;

    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'cart_id', p_cart_id,
      'amount_points', v_amount,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_balance, 0),
      'idempotency_key', v_key
    );
  end if;

  if v_balance < v_amount then
    raise exception 'Insufficient wallet balance for cart debit (have %, need %)', v_balance, v_amount;
  end if;

  v_meta :=
    coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'cart_order_stripe',
      'cart_id', p_cart_id,
      'checkout_session_id', p_checkout_session_id
    );

  insert into public.wallet_transactions (
    user_id,
    kind,
    direction,
    amount_points,
    status,
    idempotency_key,
    metadata
  )
  values (
    p_user_id,
    'debit',
    'debit',
    v_amount,
    'posted',
    v_key,
    v_meta
  )
  returning id into v_tx_id;

  update public.user_wallets uw
  set
    balance_points = uw.balance_points - v_amount,
    updated_at = now()
  where uw.id = v_wallet_id
  returning uw.balance_points into v_balance;

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'transaction_id', v_tx_id,
    'cart_id', p_cart_id,
    'amount_points', v_amount,
    'wallet_id', v_wallet_id,
    'new_balance_points', coalesce(v_balance, 0),
    'idempotency_key', v_key
  );
end;
$fn$;

create or replace function public.confirm_cart_paid_from_stripe(
  p_cart_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_delivery_channel text,
  p_relay_point_id text,
  p_delivery_line1 text
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
begin
  if p_cart_id is null or p_user_id is null then
    raise exception 'cart_id and user_id are required';
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
        jsonb_build_object(
          'stripe_checkout_session_id', p_checkout_session_id,
          'source', 'stripe_cart_order'
        )
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
        jsonb_build_object(
          'stripe_checkout_session_id', p_checkout_session_id,
          'source', 'stripe_cart_order'
        )
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
        jsonb_build_object(
          'stripe_checkout_session_id', p_checkout_session_id,
          'source', 'stripe_cart_order',
          'note', 'relay_point_missing'
        )
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

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'shipment_id', v_ship_id
  );
end;
$fn$;

comment on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text) is
  'Payé sur Stripe : panier checkout_pending|active → confirmed, shipment cart_outbound + items + destination. Idempotent si déjà confirmed. Log activity via log_activity_event_rpc (service_role).';
