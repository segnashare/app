-- Débit wallet panier : uniquement au paiement (checkout_pending), une fois par cart_id,
-- atomique avec confirm_cart_paid_from_stripe. Remboursement si abandon / expiration checkout.

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
  v_wallet_debit bigint;
  v_wallet_id uuid;
  v_balance bigint;
  v_tx_id uuid;
  v_tx_id_ex uuid;
  v_tx_id_co uuid;
  v_meta_ex jsonb;
  v_meta_co jsonb;
  v_meta_one jsonb;
  v_key text;
  v_key_ex text;
  v_key_co text;
  v_comp_amount bigint;
  v_comp_raw text;
  v_debit_ex bigint := 0;
  v_debit_co bigint := 0;
  v_ex_bal bigint;
  v_co_bal bigint;
  v_sync_ex bigint;
  v_sync_co bigint;
  v_bucket text;
  v_base_meta jsonb;
  v_cart_status public.cart_status;
begin
  if p_user_id is null or p_cart_id is null then
    raise exception 'user_id and cart_id are required';
  end if;

  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    raise exception 'p_idempotency_key is required';
  end if;

  v_key_ex := v_key || ':exchange';
  v_key_co := v_key || ':consumption';

  if exists (
    select 1
    from public.carts c
    where c.id = p_cart_id
      and c.deleted_at is null
      and c.user_id is distinct from p_user_id
  ) then
    raise exception 'Forbidden: cart does not belong to user';
  end if;

  select c.status
    into v_cart_status
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null;

  if v_cart_status is null then
    raise exception 'Cart not found';
  end if;

  if v_cart_status is distinct from 'checkout_pending'::public.cart_status then
    raise exception 'Cart wallet debit requires checkout_pending (got %)', v_cart_status;
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

  v_comp_amount := 0;
  v_comp_raw := nullif(trim(coalesce(p_metadata ->> 'stripe_wallet_comp_credits_kind', '')), '');
  begin
    if p_metadata ? 'stripe_wallet_comp_points' then
      if jsonb_typeof(p_metadata -> 'stripe_wallet_comp_points') = 'number' then
        v_comp_amount := greatest(0, (p_metadata ->> 'stripe_wallet_comp_points')::bigint);
      elsif nullif(trim(p_metadata ->> 'stripe_wallet_comp_points'), '') is not null then
        v_comp_amount := greatest(0, nullif(trim(p_metadata ->> 'stripe_wallet_comp_points'), '')::bigint);
      end if;
    end if;
  exception
    when others then
      v_comp_amount := 0;
  end;

  if v_comp_amount <= 0
     and p_checkout_session_id is not null
     and trim(p_checkout_session_id) <> '' then
    select wt.amount_points, wt.metadata ->> 'credits_kind'
      into v_comp_amount, v_comp_raw
    from public.wallet_transactions wt
    where wt.user_id = p_user_id
      and wt.idempotency_key = ('stripe:cart_order_wallet:' || trim(p_checkout_session_id))
    limit 1;
    v_comp_amount := coalesce(v_comp_amount, 0);
  end if;

  v_comp_amount := least(greatest(v_comp_amount, 0), v_amount);
  v_wallet_debit := v_amount - v_comp_amount;

  if not exists (
    select 1
    from public.user_wallets uw
    where uw.user_id = p_user_id
      and uw.deleted_at is null
  ) then
    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (p_user_id, 0, 0::bigint);
  end if;

  select uw.id, uw.balance_points, uw.balance_exchange_points, uw.balance_consumption_points
    into v_wallet_id, v_balance, v_ex_bal, v_co_bal
  from public.user_wallets uw
  where uw.user_id = p_user_id
    and uw.deleted_at is null
  order by uw.updated_at desc
  limit 1
  for update;

  if v_wallet_id is null then
    raise exception 'Wallet not found for user';
  end if;

  if exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key)
     or exists (select 1 from public.wallet_transactions wt where wt.idempotency_key in (v_key_ex, v_key_co))
     or exists (select 1 from public.cart_payments cp where cp.idempotency_key = v_key) then
    select uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
      into v_balance, v_co_bal, v_ex_bal
    from public.user_wallets uw
    where uw.id = v_wallet_id;

    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'cart_id', p_cart_id,
      'cart_total_points', v_amount,
      'wallet_debit_points', v_wallet_debit,
      'stripe_comp_points', v_comp_amount,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_balance, 0),
      'new_balance_consumption_points', coalesce(v_co_bal, 0),
      'new_balance_exchange_points', coalesce(v_ex_bal, 0),
      'idempotency_key', v_key
    );
  end if;

  if exists (
    select 1
    from public.wallet_transactions wt
    where wt.kind = 'debit'
      and wt.direction = 'debit'
      and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
      and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
      and (wt.metadata ->> 'cart_id')::uuid = p_cart_id
  ) then
    select uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
      into v_balance, v_co_bal, v_ex_bal
    from public.user_wallets uw
    where uw.id = v_wallet_id;

    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'reason', 'cart_already_debited',
      'cart_id', p_cart_id,
      'cart_total_points', v_amount,
      'wallet_debit_points', v_wallet_debit,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_balance, 0),
      'idempotency_key', v_key
    );
  end if;

  v_base_meta :=
    coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'cart_order_stripe',
      'cart_id', p_cart_id,
      'checkout_session_id', p_checkout_session_id,
      'cart_order_total_points', v_amount,
      'wallet_debit_points', v_wallet_debit,
      'stripe_wallet_comp_points', v_comp_amount,
      'stripe_wallet_comp_credits_kind', v_comp_raw,
      'stripe_comp_is_payment_not_wallet_credit', true
    );

  if v_wallet_debit <= 0 then
    if v_comp_amount <= 0 then
      raise exception 'Cart debit requires wallet or stripe complement (cart %, wallet %, comp %)',
        v_amount, coalesce(v_balance, 0), v_comp_amount;
    end if;

    insert into public.cart_payments (
      cart_id,
      user_id,
      wallet_transaction_id,
      total_points,
      exchange_points,
      consumption_points,
      stripe_wallet_topup_points,
      stripe_wallet_topup_kind,
      stripe_checkout_session_id,
      payment_channel,
      idempotency_key,
      metadata
    )
    values (
      p_cart_id,
      p_user_id,
      null,
      0,
      0,
      0,
      v_comp_amount,
      v_comp_raw,
      nullif(trim(coalesce(p_checkout_session_id, '')), ''),
      'stripe',
      v_key,
      v_base_meta
    )
    on conflict (idempotency_key) do nothing;

    return jsonb_build_object(
      'applied', true,
      'duplicate', false,
      'stripe_only', true,
      'cart_id', p_cart_id,
      'cart_total_points', v_amount,
      'wallet_debit_points', 0,
      'stripe_comp_points', v_comp_amount,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_balance, 0),
      'new_balance_consumption_points', coalesce(v_co_bal, 0),
      'new_balance_exchange_points', coalesce(v_ex_bal, 0),
      'idempotency_key', v_key
    );
  end if;

  v_sync_ex := coalesce(v_ex_bal, 0);
  v_sync_co := coalesce(v_co_bal, 0);

  if v_sync_ex + v_sync_co < v_wallet_debit then
    raise exception 'Insufficient wallet balance for cart debit (exchange %, consumption %, need wallet %, cart %, stripe comp %)',
      v_sync_ex, v_sync_co, v_wallet_debit, v_amount, v_comp_amount;
  end if;

  v_debit_co := least(v_sync_co, v_wallet_debit);
  v_debit_ex := v_wallet_debit - v_debit_co;

  if v_debit_ex > v_sync_ex then
    v_debit_ex := v_sync_ex;
    v_debit_co := v_wallet_debit - v_debit_ex;
    if v_debit_co > v_sync_co then
      raise exception 'Insufficient wallet balance for cart debit (exchange %, consumption %, need ex % co % for wallet %)',
        v_sync_ex, v_sync_co, v_debit_ex, v_debit_co, v_wallet_debit;
    end if;
  end if;

  if v_debit_ex + v_debit_co <> v_wallet_debit then
    raise exception 'Internal debit split mismatch';
  end if;

  if coalesce(v_balance, 0) < v_wallet_debit then
    raise exception 'Insufficient wallet balance for cart debit (have %, need wallet %, cart %, stripe comp %)',
      v_balance, v_wallet_debit, v_amount, v_comp_amount;
  end if;

  if v_debit_ex > 0 and v_debit_co > 0 then
    v_meta_co :=
      v_base_meta
      || jsonb_build_object(
        'debit_split', jsonb_build_object('exchange_points', 0, 'consumption_points', v_debit_co),
        'cart_debit_component', 'consumption'
      );
    v_meta_ex :=
      v_base_meta
      || jsonb_build_object(
        'debit_split', jsonb_build_object('exchange_points', v_debit_ex, 'consumption_points', 0),
        'cart_debit_component', 'exchange'
      );

    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    )
    values (
      p_user_id, 'debit', 'debit', v_debit_co, 'posted', v_key_co, v_meta_co, 'consumption'
    )
    returning id into v_tx_id_co;

    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    )
    values (
      p_user_id, 'debit', 'debit', v_debit_ex, 'posted', v_key_ex, v_meta_ex, 'exchange'
    )
    returning id into v_tx_id_ex;

    v_tx_id := v_tx_id_ex;
  else
    v_bucket :=
      case
        when v_debit_ex > 0 then 'exchange'
        else 'consumption'
      end;

    v_meta_one :=
      v_base_meta
      || jsonb_build_object(
        'debit_split', jsonb_build_object(
          'exchange_points', v_debit_ex,
          'consumption_points', v_debit_co
        )
      );

    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    )
    values (
      p_user_id, 'debit', 'debit', v_wallet_debit, 'posted', v_key, v_meta_one, v_bucket
    )
    returning id into v_tx_id;
  end if;

  update public.user_wallets uw
  set
    balance_exchange_points = case
      when v_debit_ex > 0 then greatest(0::bigint, coalesce(uw.balance_exchange_points, 0::bigint) - v_debit_ex)
      else uw.balance_exchange_points
    end,
    balance_consumption_points = uw.balance_consumption_points - v_debit_co,
    updated_at = now()
  where uw.id = v_wallet_id
  returning uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
    into v_balance, v_co_bal, v_ex_bal;

  if v_debit_ex > 0 and v_debit_co > 0 then
    return jsonb_build_object(
      'applied', true,
      'duplicate', false,
      'transaction_id', v_tx_id_ex,
      'transaction_id_consumption', v_tx_id_co,
      'cart_id', p_cart_id,
      'cart_total_points', v_amount,
      'wallet_debit_points', v_wallet_debit,
      'stripe_comp_points', v_comp_amount,
      'debit_exchange_points', v_debit_ex,
      'debit_consumption_points', v_debit_co,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_balance, 0),
      'new_balance_consumption_points', coalesce(v_co_bal, 0),
      'new_balance_exchange_points', coalesce(v_ex_bal, 0),
      'idempotency_key', v_key
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'transaction_id', v_tx_id,
    'cart_id', p_cart_id,
    'cart_total_points', v_amount,
    'wallet_debit_points', v_wallet_debit,
    'stripe_comp_points', v_comp_amount,
    'debit_exchange_points', v_debit_ex,
    'debit_consumption_points', v_debit_co,
    'wallet_id', v_wallet_id,
    'new_balance_points', coalesce(v_balance, 0),
    'new_balance_consumption_points', coalesce(v_co_bal, 0),
    'new_balance_exchange_points', coalesce(v_ex_bal, 0),
    'idempotency_key', v_key
  );
end;
$fn$;

comment on function public.wallet_debit_cart_order_stripe(uuid, uuid, text, text, jsonb) is
  'Débite le wallet au paiement panier (checkout_pending). Une seule fois par cart_id.';

-- Débit + confirmation dans la même transaction Postgres.
create or replace function public.finalize_cart_order_checkout(
  p_cart_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_wallet_idempotency_key text,
  p_wallet_metadata jsonb default '{}'::jsonb,
  p_delivery_channel text default 'relay',
  p_relay_point_id text default null,
  p_delivery_line1 text default null,
  p_return_relay_point_id text default null,
  p_return_relay_label text default null,
  p_return_relay_search_postal_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $finalize$
declare
  v_debit jsonb;
  v_confirm jsonb;
begin
  v_debit := public.wallet_debit_cart_order_stripe(
    p_user_id,
    p_cart_id,
    p_checkout_session_id,
    p_wallet_idempotency_key,
    coalesce(p_wallet_metadata, '{}'::jsonb)
  );

  v_confirm := public.confirm_cart_paid_from_stripe(
    p_cart_id,
    p_user_id,
    p_checkout_session_id,
    p_delivery_channel,
    p_relay_point_id,
    p_delivery_line1
  );

  return coalesce(v_confirm, '{}'::jsonb)
    || jsonb_build_object('wallet_debit', coalesce(v_debit, '{}'::jsonb));
end;
$finalize$;

comment on function public.finalize_cart_order_checkout(uuid, uuid, text, text, jsonb, text, text, text, text, text, text) is
  'Paiement panier : débit wallet (si applicable) + confirm_cart_paid_from_stripe, atomique.';

revoke all on function public.finalize_cart_order_checkout(uuid, uuid, text, text, jsonb, text, text, text, text, text, text) from public;
grant execute on function public.finalize_cart_order_checkout(uuid, uuid, text, text, jsonb, text, text, text, text, text, text) to service_role;

-- Abandon checkout : rembourser un débit wallet orphelin (panier non confirmé).
create or replace function public.expire_wallet_holds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $expire$
declare
  v_count integer := 0;
  v_cart record;
begin
  for v_cart in
    select c.id, c.user_id
    from public.carts c
    where c.status = 'checkout_pending'::public.cart_status
      and c.locked_until is not null
      and c.locked_until <= now()
    for update
  loop
    perform public.refund_wallet_cart_order_stripe_debit_by_cart_id(v_cart.id);

    update public.items i
    set
      status = 'in_cart'::public.item_status,
      updated_at = now()
    from public.cart_items ci
    where ci.cart_id = v_cart.id
      and ci.deleted_at is null
      and ci.item_id = i.id;

    update public.cart_items
    set
      status = 'in_cart',
      updated_at = now()
    where cart_id = v_cart.id
      and deleted_at is null
      and status in ('reserved', 'reservation_pending');

    update public.carts
    set
      status = 'active',
      locked_until = null,
      updated_at = now()
    where id = v_cart.id;

    insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
    values (v_cart.id, 'checkout_pending', 'active', 'checkout_lock_expired', null);

    perform public.log_activity_event(
      'checkout_lock_expired',
      jsonb_build_object('cart_id', v_cart.id),
      null
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$expire$;

create or replace function public.release_wallet_hold(
  p_cart_id uuid,
  p_idempotency_key text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $release$
declare
  v_uid uuid;
  v_cart_owner uuid;
  v_reason text;
  v_cart_status public.cart_status;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select c.user_id, c.status
    into v_cart_owner, v_cart_status
  from public.carts c
  where c.id = p_cart_id;

  if not found then
    raise exception 'Cart not found';
  end if;

  if v_cart_owner is distinct from v_uid then
    raise exception 'Forbidden: cart does not belong to current user';
  end if;

  if v_cart_status is distinct from 'checkout_pending'::public.cart_status then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_checkout_pending');
  end if;

  perform public.refund_wallet_cart_order_stripe_debit_by_cart_id(p_cart_id);

  v_reason := coalesce(nullif(trim(p_reason), ''), 'payment_page_exit');

  update public.items i
  set
    status = 'in_cart'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id;

  update public.cart_items
  set
    status = 'in_cart',
    updated_at = now()
  where cart_id = p_cart_id
    and deleted_at is null
    and status in ('reserved', 'reservation_pending');

  update public.carts
  set
    status = 'active',
    locked_until = null,
    updated_at = now()
  where id = p_cart_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (p_cart_id, 'checkout_pending', 'active', 'checkout_abandoned_client', v_uid);

  perform public.log_activity_event(
    'checkout_abandoned',
    jsonb_build_object(
      'cart_id', p_cart_id,
      'release_reason', v_reason
    ),
    v_uid
  );

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id
  );
end;
$release$;

grant execute on function public.release_wallet_hold(uuid, text, text) to authenticated;
