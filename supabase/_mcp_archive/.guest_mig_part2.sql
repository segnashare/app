-- ---------------------------------------------------------------------------
-- wallet_credit_purchase : erreur explicite avant insert
-- ---------------------------------------------------------------------------

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
  v_new_total bigint;
  v_new_co bigint;
  v_new_ex bigint;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_amount_points is null or p_amount_points <= 0 then
    raise exception 'p_amount_points must be > 0';
  end if;

  v_effective_kind := lower(trim(coalesce(p_credit_kind, '')));
  if v_effective_kind in ('pods', 'consommation') then
    v_effective_kind := 'consumption';
  elsif v_effective_kind = 'mods' then
    v_effective_kind := 'exchange';
  end if;
  if v_effective_kind not in ('consumption', 'exchange') then
    raise exception 'Invalid p_credit_kind: %', p_credit_kind;
  end if;

  if v_effective_kind = 'exchange' and not public.user_can_reserve_cart_inventory(p_user_id) then
    raise exception 'GUEST_EXCHANGE_CREDIT_PURCHASE_NOT_ALLOWED';
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
    'credit',
    'credit',
    p_amount_points,
    'posted',
    v_effective_idempotency_key,
    v_metadata,
    v_effective_kind
  )
  on conflict (idempotency_key) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    select uw.id, uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
      into v_wallet_id, v_new_total, v_new_co, v_new_ex
    from public.user_wallets uw
    where uw.user_id = p_user_id
      and uw.deleted_at is null
    order by uw.updated_at desc
    limit 1;

    return jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'wallet_id', v_wallet_id,
      'new_balance_points', coalesce(v_new_total, 0),
      'new_balance_consumption_points', coalesce(v_new_co, 0),
      'new_balance_exchange_points', coalesce(v_new_ex, 0),
      'idempotency_key', v_effective_idempotency_key
    );
  end if;

  update public.user_wallets uw
     set
       balance_consumption_points = uw.balance_consumption_points
         + case when v_effective_kind = 'consumption' then p_amount_points else 0 end,
       balance_exchange_points = case
         when v_effective_kind = 'exchange' then coalesce(uw.balance_exchange_points, 0) + p_amount_points
         else uw.balance_exchange_points
       end,
       updated_at = now()
   where uw.id = (
      select id
      from public.user_wallets
      where user_id = p_user_id
        and deleted_at is null
      order by updated_at desc
      limit 1
   )
  returning uw.id, uw.balance_points, uw.balance_consumption_points, uw.balance_exchange_points
    into v_wallet_id, v_new_total, v_new_co, v_new_ex;

  if v_wallet_id is null then
    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (
      p_user_id,
      case when v_effective_kind = 'consumption' then p_amount_points else 0 end,
      case when v_effective_kind = 'exchange' then p_amount_points else null end
    )
    returning id, balance_points, balance_consumption_points, balance_exchange_points
      into v_wallet_id, v_new_total, v_new_co, v_new_ex;
  end if;

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'wallet_id', v_wallet_id,
    'new_balance_points', v_new_total,
    'new_balance_consumption_points', v_new_co,
    'new_balance_exchange_points', v_new_ex,
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

-- ---------------------------------------------------------------------------
-- Crédit prêt vérifié : pas de wallet pour invité (l’état intake reste appliqué)
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

  if not public.user_can_reserve_cart_inventory(v_owner) then
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