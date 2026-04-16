-- Répartition débit panier : ne plus imputer tout le reliquat aux mods pour les abonnés.
-- On débite d’abord l’échange jusqu’au solde disponible, puis la consommation pour le reste,
-- tant que le total (échange + consommation) couvre le panier (après crédit Stripe le cas échéant).

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
set search_path = 'public'
as $fn$
declare
  v_amount bigint;
  v_wallet_id uuid;
  v_balance bigint;
  v_tx_id uuid;
  v_meta jsonb;
  v_key text;
  v_is_subscriber boolean;
  v_comp_amount bigint;
  v_comp_raw text;
  v_debit_ex bigint := 0;
  v_debit_co bigint := 0;
  v_ex_bal bigint;
  v_co_bal bigint;
  v_sync_ex bigint;
  v_sync_co bigint;
  v_bucket text;
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

  select exists (
    select 1
    from public.user_subscriptions s
    where s.user_id = p_user_id
      and s.provider = 'stripe'
      and lower(coalesce(s.status, '')) in ('active', 'trialing')
  )
  into v_is_subscriber;

  if not exists (
    select 1
    from public.user_wallets uw
    where uw.user_id = p_user_id
      and uw.deleted_at is null
  ) then
    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (p_user_id, 0, case when v_is_subscriber then 0::bigint else null end);
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

  if exists (
    select 1
    from public.wallet_transactions wt
    where wt.idempotency_key = v_key
  ) then
    select uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
      into v_balance, v_co_bal, v_ex_bal
    from public.user_wallets uw
    where uw.id = v_wallet_id;

    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'cart_id', p_cart_id,
      'amount_points', v_amount,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_balance, 0),
      'new_balance_consumption_points', coalesce(v_co_bal, 0),
      'new_balance_exchange_points', coalesce(v_ex_bal, 0),
      'idempotency_key', v_key
    );
  end if;

  v_comp_amount := 0;
  v_comp_raw := null;
  if p_checkout_session_id is not null and trim(p_checkout_session_id) <> '' then
    select wt.amount_points, wt.metadata->>'credits_kind'
      into v_comp_amount, v_comp_raw
    from public.wallet_transactions wt
    where wt.user_id = p_user_id
      and wt.idempotency_key = ('stripe:cart_order_wallet:' || trim(p_checkout_session_id))
    limit 1;
  end if;
  v_comp_amount := coalesce(v_comp_amount, 0);

  v_sync_ex := coalesce(v_ex_bal, 0);
  v_sync_co := coalesce(v_co_bal, 0);

  if v_sync_ex + v_sync_co < v_amount then
    raise exception 'Insufficient wallet balance for cart debit (exchange %, consumption %, need total %)',
      v_sync_ex, v_sync_co, v_amount;
  end if;

  -- Maximiser le débit échange, puis consommation (répartition réalisable).
  v_debit_ex := least(v_sync_ex, v_amount);
  v_debit_co := v_amount - v_debit_ex;

  if v_debit_co > v_sync_co then
    v_debit_co := v_sync_co;
    v_debit_ex := v_amount - v_debit_co;
    if v_debit_ex > v_sync_ex then
      raise exception 'Insufficient wallet balance for cart debit (exchange %, consumption %, need ex % co % for total %)',
        v_sync_ex, v_sync_co, v_debit_ex, v_debit_co, v_amount;
    end if;
  end if;

  if v_debit_ex + v_debit_co <> v_amount then
    raise exception 'Internal debit split mismatch';
  end if;

  if coalesce(v_balance, 0) < v_amount then
    raise exception 'Insufficient wallet balance for cart debit (have %, need %)', v_balance, v_amount;
  end if;

  v_bucket :=
    case
      when v_debit_ex > 0 and v_debit_co > 0 then 'mixed'
      when v_debit_ex > 0 then 'exchange'
      else 'consumption'
    end;

  v_meta :=
    coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'cart_order_stripe',
      'cart_id', p_cart_id,
      'checkout_session_id', p_checkout_session_id,
      'stripe_wallet_comp_points', v_comp_amount,
      'stripe_wallet_comp_credits_kind', v_comp_raw,
      'debit_split', jsonb_build_object(
        'exchange_points', v_debit_ex,
        'consumption_points', v_debit_co
      )
    );

  insert into public.wallet_transactions (
    user_id,
    kind,
    direction,
    amount_points,
    status,
    idempotency_key,
    metadata,
    credit_bucket
  )
  values (
    p_user_id,
    'debit',
    'debit',
    v_amount,
    'posted',
    v_key,
    v_meta,
    v_bucket
  )
  returning id into v_tx_id;

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

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'transaction_id', v_tx_id,
    'cart_id', p_cart_id,
    'amount_points', v_amount,
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
  'Débite le panier payé : répartition échange puis consommation selon les soldes (après crédit Stripe). Idempotent via p_idempotency_key.';
