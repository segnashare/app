create or replace function public.wallet_credit_purchase(
  p_user_id uuid,
  p_amount_points bigint,
  p_credit_kind text,
  p_provider text default 'stripe',
  p_checkout_session_id text default null,
  p_payment_intent_id text default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_kind text;
  v_effective_provider text;
  v_effective_idempotency_key text;
  v_metadata jsonb;
  v_tx_id uuid;
  v_wallet_id uuid;
  v_new_balance bigint;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_amount_points is null or p_amount_points <= 0 then
    raise exception 'p_amount_points must be > 0';
  end if;

  v_effective_kind := lower(coalesce(p_credit_kind, ''));
  if v_effective_kind not in ('pods', 'mods') then
    raise exception 'Invalid p_credit_kind: %', p_credit_kind;
  end if;

  v_effective_provider := lower(coalesce(nullif(p_provider, ''), 'stripe'));

  v_effective_idempotency_key := coalesce(
    nullif(p_idempotency_key, ''),
    case
      when p_checkout_session_id is not null and p_checkout_session_id <> '' then format('%s:credits_purchase:%s', v_effective_provider, p_checkout_session_id)
      else null
    end
  );

  if v_effective_idempotency_key is null then
    raise exception 'p_idempotency_key or p_checkout_session_id is required';
  end if;

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'credits_purchase',
      'provider', v_effective_provider,
      'credits_kind', v_effective_kind,
      'checkout_session_id', p_checkout_session_id,
      'payment_intent_id', p_payment_intent_id
    );

  insert into public.wallet_transactions (
    user_id,
    cart_id,
    kind,
    direction,
    amount_points,
    status,
    idempotency_key,
    metadata
  )
  values (
    p_user_id,
    null,
    'credit',
    'credit',
    p_amount_points,
    'posted',
    v_effective_idempotency_key,
    v_metadata
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    select uw.id, uw.balance_points
      into v_wallet_id, v_new_balance
    from public.user_wallets uw
    where uw.user_id = p_user_id
      and uw.deleted_at is null
    order by uw.updated_at desc
    limit 1;

    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_new_balance, 0),
      'idempotency_key', v_effective_idempotency_key
    );
  end if;

  update public.user_wallets uw
     set balance_points = uw.balance_points + p_amount_points
   where uw.id = (
      select id
      from public.user_wallets
      where user_id = p_user_id
        and deleted_at is null
      order by updated_at desc
      limit 1
   )
  returning uw.id, uw.balance_points into v_wallet_id, v_new_balance;

  if v_wallet_id is null then
    insert into public.user_wallets (user_id, balance_points)
    values (p_user_id, p_amount_points)
    returning id, balance_points into v_wallet_id, v_new_balance;
  end if;

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'wallet_id', v_wallet_id,
    'new_balance_points', v_new_balance,
    'transaction_id', v_tx_id,
    'idempotency_key', v_effective_idempotency_key
  );
end;
$$;

revoke all on function public.wallet_credit_purchase(
  uuid, bigint, text, text, text, text, text, jsonb
) from public;
grant execute on function public.wallet_credit_purchase(
  uuid, bigint, text, text, text, text, text, jsonb
) to authenticated;
