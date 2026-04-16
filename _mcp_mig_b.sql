-- ---------------------------------------------------------------------------
-- Crédit prêt vérifié
-- ---------------------------------------------------------------------------

create or replace function public.item_intake_after_verified_wallet_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_points bigint;
  v_tx_id uuid;
  v_wallet_id uuid;
  v_new_total bigint;
  v_new_co bigint;
  v_new_ex bigint;
  v_key text;
begin
  if new.listing_stage::text <> 'validated'
     or new.fulfillment_stage::text <> 'verified' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.listing_stage::text = 'validated'
       and old.fulfillment_stage::text = 'verified' then
      return new;
    end if;
  end if;

  select i.owner_user_id, coalesce(i.price_points, 0)::bigint
    into v_owner, v_points
  from public.items i
  where i.id = new.item_id
    and i.deleted_at is null;

  if v_owner is null or v_points <= 0 then
    return new;
  end if;

  v_key := 'intake_verified_lend_credit:' || new.item_id::text;

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
    v_owner,
    'credit',
    'credit',
    v_points,
    'posted',
    v_key,
    jsonb_build_object(
      'source', 'lend_intake_verified',
      'item_id', new.item_id
    ),
    'exchange'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    return new;
  end if;

  update public.user_wallets uw
     set
       balance_exchange_points = coalesce(uw.balance_exchange_points, 0) + v_points,
       updated_at = now()
   where uw.id = (
      select id
      from public.user_wallets
      where user_id = v_owner
        and deleted_at is null
      order by updated_at desc
      limit 1
   )
  returning uw.id, uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
    into v_wallet_id, v_new_total, v_new_co, v_new_ex;

  if v_wallet_id is null then
    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (v_owner, 0, v_points)
    returning id, balance_points, balance_consumption_points, balance_exchange_points
      into v_wallet_id, v_new_total, v_new_co, v_new_ex;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Débit panier Stripe
-- ---------------------------------------------------------------------------

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
  v_comp_kind text;
  v_rest bigint;
  v_debit_ex bigint := 0;
  v_debit_co bigint := 0;
  v_ex_bal bigint;
  v_co_bal bigint;
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
  v_comp_kind := null;
  if p_checkout_session_id is not null and trim(p_checkout_session_id) <> '' then
    select wt.amount_points, lower(trim(coalesce(wt.metadata->>'credits_kind', '')))
      into v_comp_amount, v_comp_raw
    from public.wallet_transactions wt
    where wt.user_id = p_user_id
      and wt.idempotency_key = ('stripe:cart_order_wallet:' || trim(p_checkout_session_id))
    limit 1;
    v_comp_amount := coalesce(v_comp_amount, 0);
    if v_comp_raw in ('consumption', 'pods', 'consommation') then
      v_comp_kind := 'consumption';
    elsif v_comp_raw in ('exchange', 'mods') then
      v_comp_kind := 'exchange';
    end if;
  end if;

  if v_comp_amount > 0 and v_comp_kind is null then
    v_comp_kind := case when v_is_subscriber then 'exchange' else 'consumption' end;
  end if;

  if coalesce(v_comp_amount, 0) > v_amount then
    v_comp_amount := v_amount;
  end if;

  v_rest := v_amount - coalesce(v_comp_amount, 0);
  if v_rest < 0 then
    v_rest := 0;
  end if;

  v_debit_ex := 0;
  v_debit_co := 0;
  if coalesce(v_comp_amount, 0) > 0 and v_comp_kind = 'exchange' then
    v_debit_ex := v_debit_ex + v_comp_amount;
  elsif coalesce(v_comp_amount, 0) > 0 and v_comp_kind = 'consumption' then
    v_debit_co := v_debit_co + v_comp_amount;
  end if;

  if v_is_subscriber then
    v_debit_ex := v_debit_ex + v_rest;
  else
    v_debit_co := v_debit_co + v_rest;
  end if;

  if v_debit_ex + v_debit_co <> v_amount then
    raise exception 'Internal debit split mismatch';
  end if;

  if coalesce(v_ex_bal, 0) < v_debit_ex or v_co_bal < v_debit_co then
    raise exception 'Insufficient wallet balance for cart debit (exchange %, consumption %, need ex % co %)',
      v_ex_bal, v_co_bal, v_debit_ex, v_debit_co;
  end if;

  if v_balance < v_amount then
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

-- ---------------------------------------------------------------------------
-- Débit retired (échange)
-- ---------------------------------------------------------------------------

create or replace function public.wallet_apply_retired_lend_debit(
  p_item_id uuid,
  p_previous_item_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_points bigint;
  v_item_status text;
  v_busy boolean;
  v_credit_key text;
  v_debit_key text;
  v_tx_id uuid;
  v_wallet_id uuid;
  v_new_total bigint;
  v_new_co bigint;
  v_new_ex bigint;
begin
  if p_item_id is null then
    return jsonb_build_object('applied', false, 'reason', 'missing_item_id');
  end if;

  v_credit_key := 'intake_verified_lend_credit:' || p_item_id::text;
  v_debit_key := 'item_retired_lend_debit:' || p_item_id::text;

  select i.owner_user_id, coalesce(i.price_points, 0)::bigint, i.status::text
    into v_owner, v_points, v_item_status
  from public.items i
  where i.id = p_item_id
    and i.deleted_at is null;

  if v_owner is null then
    return jsonb_build_object('applied', false, 'reason', 'item_not_found');
  end if;

  if auth.role() is distinct from 'service_role' and v_owner is distinct from auth.uid() then
    return jsonb_build_object('applied', false, 'reason', 'forbidden');
  end if;

  if v_item_status <> 'retired' then
    return jsonb_build_object('applied', false, 'reason', 'not_retired', 'status', v_item_status);
  end if;

  if lower(coalesce(p_previous_item_status, '')) in ('reserved', 'in_cart') then
    return jsonb_build_object('applied', false, 'reason', 'borrow_status_previous', 'previous', p_previous_item_status);
  end if;

  select exists (
    select 1
    from public.cart_items ci
    where ci.item_id = p_item_id
      and ci.deleted_at is null
      and ci.status = 'reserved'
  )
  into v_busy;

  if v_busy then
    return jsonb_build_object('applied', false, 'reason', 'cart_reserved_line');
  end if;

  if v_points <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'zero_points');
  end if;

  if not exists (
    select 1
    from public.wallet_transactions wt
    where wt.idempotency_key = v_credit_key
      and wt.user_id = v_owner
      and wt.direction = 'credit'
      and wt.status = 'posted'
  ) then
    return jsonb_build_object('applied', false, 'reason', 'no_prior_lend_credit');
  end if;

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
    v_owner,
    'debit',
    'debit',
    v_points,
    'posted',
    v_debit_key,
    jsonb_build_object(
      'source', 'item_retired_lend_reversal',
      'item_id', p_item_id
    ),
    'exchange'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    return jsonb_build_object('applied', false, 'reason', 'duplicate', 'idempotency_key', v_debit_key);
  end if;

  update public.user_wallets uw
     set
       balance_exchange_points = greatest(0::bigint, coalesce(uw.balance_exchange_points, 0::bigint) - v_points),
       updated_at = now()
   where uw.id = (
      select id
      from public.user_wallets
      where user_id = v_owner
        and deleted_at is null
      order by updated_at desc
      limit 1
   )
  returning uw.id, uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
    into v_wallet_id, v_new_total, v_new_co, v_new_ex;

  return jsonb_build_object(
    'applied', true,
    'reason', 'ok',
    'amount_points', v_points,
    'wallet_id', v_wallet_id,
    'new_balance_points', coalesce(v_new_total, 0),
    'new_balance_consumption_points', coalesce(v_new_co, 0),
    'new_balance_exchange_points', coalesce(v_new_ex, 0)
  );
end;
$$;
