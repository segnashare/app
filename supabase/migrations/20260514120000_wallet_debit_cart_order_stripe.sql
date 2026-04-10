-- Débit wallet (échange) au moment où la commande panier est payée sur Stripe.
-- Montant = somme des price_points des lignes panier (source de vérité DB, pas les metadata Stripe).

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

comment on function public.wallet_debit_cart_order_stripe(uuid, uuid, text, text, jsonb) is
  'Débite les mods/pods d''un panier payé (somme price_points des lignes). Idempotent via p_idempotency_key. À appeler après wallet_credit_purchase du complément Stripe.';

revoke all on function public.wallet_debit_cart_order_stripe(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.wallet_debit_cart_order_stripe(uuid, uuid, text, text, jsonb) to service_role;
