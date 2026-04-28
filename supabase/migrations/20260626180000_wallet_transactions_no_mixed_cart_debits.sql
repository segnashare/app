-- Plus de credit_bucket = mixed : chaque débit panier `cart_order_stripe` est une ligne exchange OU consommation ;
-- si les deux seaux sont utilisés, deux lignes avec idempotency_key suffixées :exchange et :consumption.
-- Données historiques mixed → scission + contrainte CHECK sans mixed.
-- RPC alignés : débit panier, annulation membre, remboursement orphan/DELETE, retour BO, cart_payments trigger.

-- ---------------------------------------------------------------------------
-- 1) Backfill : lignes mixed → exchange + nouvelle ligne consommation (+ cart_payments)
-- ---------------------------------------------------------------------------

do $bf$
declare
  r record;
  v_ex bigint;
  v_co bigint;
  v_new_id uuid;
  v_meta_ex jsonb;
  v_meta_co jsonb;
begin
  for r in
    select wt.id, wt.user_id, wt.idempotency_key as ik, wt.metadata, wt.status
    from public.wallet_transactions wt
    where wt.kind = 'debit'
      and wt.direction = 'debit'
      and lower(trim(coalesce(wt.credit_bucket, ''))) = 'mixed'
      and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
  loop
    if r.metadata ? 'debit_split' and jsonb_typeof(r.metadata -> 'debit_split') = 'object' then
      v_ex := greatest(0::bigint, coalesce((r.metadata -> 'debit_split' ->> 'exchange_points')::bigint, 0));
      v_co := greatest(0::bigint, coalesce((r.metadata -> 'debit_split' ->> 'consumption_points')::bigint, 0));
    else
      continue;
    end if;

    if v_ex <= 0 or v_co <= 0 then
      continue;
    end if;

    if r.ik like '%:exchange' or r.ik like '%:consumption' then
      continue;
    end if;

    v_meta_ex :=
      (r.metadata - 'debit_split')
      || jsonb_build_object(
        'debit_split',
        jsonb_build_object('exchange_points', v_ex, 'consumption_points', 0),
        'cart_debit_component',
        'exchange'
      );
    v_meta_co :=
      (r.metadata - 'debit_split')
      || jsonb_build_object(
        'debit_split',
        jsonb_build_object('exchange_points', 0, 'consumption_points', v_co),
        'cart_debit_component',
        'consumption'
      );

    update public.wallet_transactions wt
    set
      amount_points = v_ex,
      credit_bucket = 'exchange',
      idempotency_key = r.ik || ':exchange',
      metadata = v_meta_ex
    where wt.id = r.id;

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
      r.user_id,
      'debit',
      'debit',
      v_co,
      coalesce(r.status, 'posted'),
      r.ik || ':consumption',
      v_meta_co,
      'consumption'
    )
    returning id into v_new_id;

    update public.cart_payments cp
    set
      idempotency_key = r.ik || ':exchange',
      total_points = v_ex,
      exchange_points = v_ex,
      consumption_points = 0
    where cp.wallet_transaction_id = r.id
       or cp.idempotency_key = r.ik;

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
    select
      cp.cart_id,
      cp.user_id,
      v_new_id,
      v_co,
      0,
      v_co,
      0,
      cp.stripe_wallet_topup_kind,
      cp.stripe_checkout_session_id,
      cp.payment_channel,
      r.ik || ':consumption',
      cp.metadata
    from public.cart_payments cp
    where cp.idempotency_key = r.ik || ':exchange'
    limit 1;
  end loop;

  update public.wallet_transactions wt
  set
    credit_bucket = 'exchange',
    metadata = coalesce(wt.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'debit_split',
        jsonb_build_object('exchange_points', wt.amount_points, 'consumption_points', 0),
        'mixed_ledger_normalized',
        true
      )
  where wt.kind = 'debit'
    and wt.direction = 'debit'
    and lower(trim(coalesce(wt.credit_bucket, ''))) = 'mixed'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe';
end;
$bf$;

-- ---------------------------------------------------------------------------
-- 2) wallet_debit_cart_order_stripe : deux INSERT si débit mixte (soldes)
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

  if exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key) then
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

  if v_debit_ex > 0 and v_debit_co > 0 then
    if exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex)
       and exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
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
        'idempotency_key', v_key_ex
      );
    end if;

    if exists (
      select 1
      from public.wallet_transactions wt
      where wt.idempotency_key in (v_key_ex, v_key_co)
    ) then
      raise exception 'CART_ORDER_DEBIT_PARTIAL_IDEMPOTENCY:%', v_key;
    end if;

    v_meta_ex :=
      coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'source', 'cart_order_stripe',
        'cart_id', p_cart_id,
        'checkout_session_id', p_checkout_session_id,
        'stripe_wallet_comp_points', v_comp_amount,
        'stripe_wallet_comp_credits_kind', v_comp_raw,
        'debit_split', jsonb_build_object(
          'exchange_points', v_debit_ex,
          'consumption_points', 0
        ),
        'cart_debit_component', 'exchange'
      );
    v_meta_co :=
      coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'source', 'cart_order_stripe',
        'cart_id', p_cart_id,
        'checkout_session_id', p_checkout_session_id,
        'stripe_wallet_comp_points', v_comp_amount,
        'stripe_wallet_comp_credits_kind', v_comp_raw,
        'debit_split', jsonb_build_object(
          'exchange_points', 0,
          'consumption_points', v_debit_co
        ),
        'cart_debit_component', 'consumption'
      );

    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    )
    values (
      p_user_id, 'debit', 'debit', v_debit_ex, 'posted', v_key_ex, v_meta_ex, 'exchange'
    )
    returning id into v_tx_id_ex;

    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    )
    values (
      p_user_id, 'debit', 'debit', v_debit_co, 'posted', v_key_co, v_meta_co, 'consumption'
    )
    returning id into v_tx_id_co;

    v_tx_id := v_tx_id_ex;
  else
    v_bucket :=
      case
        when v_debit_ex > 0 then 'exchange'
        else 'consumption'
      end;

    v_meta_one :=
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
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    )
    values (
      p_user_id, 'debit', 'debit', v_amount, 'posted', v_key, v_meta_one, v_bucket
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
      'amount_points', v_amount,
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
  'Débite le panier payé : une ligne par seau (exchange / consumption). Débit mixte → deux lignes : idempotency_key suffixée :exchange et :consumption.';

-- ---------------------------------------------------------------------------
-- 3) member_cancel_cart_order_pending_preparation : agrégation des débits panier
-- ---------------------------------------------------------------------------

create or replace function public.member_cancel_cart_order_pending_preparation(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_cart_status public.cart_status;
  v_ship_id uuid;
  v_ship_status public.shipment_status;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_debit_anchor_id uuid;
  v_sum_debits bigint;
  v_key_ex text;
  v_key_co text;
  v_wallet_id uuid;
  v_did_ex boolean := false;
  v_did_co boolean := false;
  v_sub_plan text;
  v_sub_status text;
  v_period_month date := date_trunc('month', timezone('utc', now()))::date;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_cart_id is null then
    raise exception 'cart_id is required';
  end if;

  select c.user_id, c.status
    into v_owner, v_cart_status
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'CART_NOT_FOUND';
  end if;

  if v_owner is distinct from v_uid then
    raise exception 'FORBIDDEN';
  end if;

  if v_cart_status = 'canceled'::public.cart_status then
    return jsonb_build_object('ok', true, 'already_canceled', true, 'cart_id', p_cart_id);
  end if;

  if v_cart_status is distinct from 'confirmed'::public.cart_status then
    raise exception 'CART_NOT_CANCELLABLE_STATUS:%', v_cart_status;
  end if;

  if exists (
    select 1
    from public.cart_order_stripe_invoices i
    where i.cart_id = p_cart_id
      and coalesce(i.amount_total_cents, 0) > 0
  ) then
    raise exception 'CART_CANCEL_STRIPE_PAYMENT_RECORDED';
  end if;

  select s.id, s.status
    into v_ship_id, v_ship_status
  from public.shipments s
  where s.cart_id = p_cart_id
    and s.context = 'cart_outbound'::public.shipment_context
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;

  if v_ship_id is null then
    raise exception 'OUTBOUND_SHIPMENT_NOT_FOUND';
  end if;

  if v_ship_status is distinct from 'pending'::public.shipment_status then
    raise exception 'SHIPMENT_NOT_PENDING:%', v_ship_status;
  end if;

  select
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'exchange_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'exchange' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'consumption_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'consumption' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    (array_agg(wt.id order by wt.id desc))[1],
    coalesce(sum(wt.amount_points), 0::bigint)
  into v_ex, v_co, v_debit_anchor_id, v_sum_debits
  from public.wallet_transactions wt
  where wt.user_id = v_uid
    and wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
    and (wt.metadata ->> 'cart_id')::uuid = p_cart_id;

  if v_debit_anchor_id is null or (v_ex <= 0 and v_co <= 0) then
    raise exception 'CART_DEBIT_NOT_FOUND';
  end if;

  if v_sum_debits <> v_ex + v_co then
    raise exception 'CART_DEBIT_SPLIT_MISMATCH';
  end if;

  if not public.user_can_reserve_cart_inventory(v_uid) then
    v_co := v_co + v_ex;
    v_ex := 0;
  end if;

  v_key_ex := format('cart_order_cancel_refund_ex:%s', p_cart_id);
  v_key_co := format('cart_order_cancel_refund_co:%s', p_cart_id);

  if v_ex > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid,
      'credit',
      'credit',
      v_ex,
      'posted',
      v_key_ex,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'exchange'
      ),
      'exchange'
    );
    v_did_ex := true;
  end if;

  if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid,
      'credit',
      'credit',
      v_co,
      'posted',
      v_key_co,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'consumption'
      ),
      'consumption'
    );
    v_did_co := true;
  end if;

  if v_did_ex or v_did_co then
    update public.user_wallets uw
    set
      balance_exchange_points = case
        when v_did_ex then coalesce(uw.balance_exchange_points, 0) + v_ex
        else uw.balance_exchange_points
      end,
      balance_consumption_points = case
        when v_did_co then uw.balance_consumption_points + v_co
        else uw.balance_consumption_points
      end,
      updated_at = now()
    where uw.id = (
      select id from public.user_wallets
      where user_id = v_uid and deleted_at is null
      order by updated_at desc
      limit 1
    )
    returning uw.id into v_wallet_id;

    if v_wallet_id is null then
      insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
      values (
        v_uid,
        case when v_did_co then v_co else 0 end,
        case when v_did_ex then v_ex else null end
      )
      returning id into v_wallet_id;
    end if;
  end if;

  update public.items i
  set
    status = 'listed'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id
    and i.deleted_at is null
    and i.status = 'reserved'::public.item_status;

  update public.cart_items ci
  set
    status = 'archived'::public.cart_item_status,
    updated_at = now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null;

  update public.shipments s
  set
    status = 'closed'::public.shipment_status,
    updated_at = now()
  where s.id = v_ship_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    p_cart_id,
    'confirmed'::public.cart_status,
    'canceled'::public.cart_status,
    'member_cancel_pending_preparation',
    v_uid
  );

  update public.carts c
  set
    status = 'canceled'::public.cart_status,
    locked_until = null,
    updated_at = now()
  where c.id = p_cart_id;

  select s.plan_code, s.status
    into v_sub_plan, v_sub_status
  from public.user_subscriptions s
  where s.user_id = v_uid
    and s.provider = 'stripe'
  order by s.updated_at desc
  limit 1;

  if v_sub_status in ('active', 'trialing')
     and v_sub_plan in ('segna_plus', 'segna_x') then
    update public.user_monthly_entitlements e
    set
      orders_used = greatest(0, e.orders_used - 1),
      updated_at = now()
    where e.user_id = v_uid
      and e.period_month = v_period_month
      and e.orders_used > 0;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'refunded_exchange_points', v_ex,
    'refunded_consumption_points', v_co
  );
end;
$fn$;

comment on function public.member_cancel_cart_order_pending_preparation(uuid) is
  'Membre : annule une commande confirmée tant que l’expédition aller est pending, sans facture Stripe (montant > 0). Rembourse crédits (tous les débits panier agrégés), items → listed, panier canceled.';

revoke all on function public.member_cancel_cart_order_pending_preparation(uuid) from public;
grant execute on function public.member_cancel_cart_order_pending_preparation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) refund_wallet_cart_order_stripe_debit_by_cart_id : agrégation
-- ---------------------------------------------------------------------------

create or replace function public.refund_wallet_cart_order_stripe_debit_by_cart_id(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $rf$
declare
  v_uid uuid;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_debit_anchor_id uuid;
  v_sum_debits bigint;
  v_key_ex text;
  v_key_co text;
  v_wallet_id uuid;
  v_did_ex boolean := false;
  v_did_co boolean := false;
begin
  if p_cart_id is null then
    return jsonb_build_object('ok', false, 'error', 'cart_id_required');
  end if;

  select
    (array_agg(wt.user_id order by wt.id desc))[1],
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'exchange_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'exchange' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'consumption_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'consumption' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    (array_agg(wt.id order by wt.id desc))[1],
    coalesce(sum(wt.amount_points), 0::bigint)
  into v_uid, v_ex, v_co, v_debit_anchor_id, v_sum_debits
  from public.wallet_transactions wt
  where wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
    and (wt.metadata ->> 'cart_id')::uuid = p_cart_id;

  if v_uid is null or (v_ex <= 0 and v_co <= 0) then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'no_cart_order_stripe_debit',
      'cart_id', p_cart_id
    );
  end if;

  if v_sum_debits <> v_ex + v_co then
    return jsonb_build_object('ok', false, 'error', 'cart_debit_split_mismatch', 'cart_id', p_cart_id);
  end if;

  if not public.user_can_reserve_cart_inventory(v_uid) then
    v_co := v_co + v_ex;
    v_ex := 0;
  end if;

  v_key_ex := format('cart_order_cancel_refund_ex:%s', p_cart_id);
  v_key_co := format('cart_order_cancel_refund_co:%s', p_cart_id);

  if v_ex > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid,
      'credit',
      'credit',
      v_ex,
      'posted',
      v_key_ex,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'exchange',
        'refund_reason', 'cart_deleted_or_orphan_repair'
      ),
      'exchange'
    );
    v_did_ex := true;
  end if;

  if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid,
      'credit',
      'credit',
      v_co,
      'posted',
      v_key_co,
      jsonb_build_object(
        'source', 'cart_order_cancel',
        'cart_id', p_cart_id,
        'refunds_debit_wallet_tx', v_debit_anchor_id,
        'credits_kind', 'consumption',
        'refund_reason', 'cart_deleted_or_orphan_repair'
      ),
      'consumption'
    );
    v_did_co := true;
  end if;

  if not v_did_ex and not v_did_co then
    return jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'cart_id', p_cart_id,
      'debit_wallet_tx', v_debit_anchor_id
    );
  end if;

  update public.user_wallets uw
  set
    balance_exchange_points = case
      when v_did_ex then coalesce(uw.balance_exchange_points, 0) + v_ex
      else uw.balance_exchange_points
    end,
    balance_consumption_points = case
      when v_did_co then uw.balance_consumption_points + v_co
      else uw.balance_consumption_points
    end,
    updated_at = now()
  where uw.id = (
    select id from public.user_wallets
    where user_id = v_uid and deleted_at is null
    order by updated_at desc
    limit 1
  )
  returning uw.id into v_wallet_id;

  if v_wallet_id is null then
    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (
      v_uid,
      case when v_did_co then v_co else 0 end,
      case when v_did_ex then v_ex else null end
    )
    returning id into v_wallet_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'debit_wallet_tx', v_debit_anchor_id,
    'refunded_exchange_points', case when v_did_ex then v_ex else 0 end,
    'refunded_consumption_points', case when v_did_co then v_co else 0 end,
    'wallet_row_id', v_wallet_id
  );
end;
$rf$;

comment on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) is
  'Recredite wallet from all cart_order_stripe debits for cart_id; idempotent cancel keys; service_role or DELETE trigger.';

revoke all on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) from public;
grant execute on function public.refund_wallet_cart_order_stripe_debit_by_cart_id(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5) close_cart_return_verification_ok : agrégation débits panier
-- ---------------------------------------------------------------------------

create or replace function public.close_cart_return_verification_ok(
  p_shipment_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_ship record;
  v_cart record;
  v_cart_id uuid;
  v_user_id uuid;
  v_pending int := 0;
  v_rejected int := 0;
  v_ok_lines int := 0;
  v_ex bigint := 0;
  v_co bigint := 0;
  v_key_ex text;
  v_key_co text;
  v_idem_base text;
  v_wallet_id uuid;
  v_w_bco bigint;
  v_w_bex bigint;
  v_did_ex boolean := false;
  v_did_co boolean := false;
  v_now timestamptz := timezone('utc', now());
  v_post_clean_block int := 0;
  v_archived_lines int := 0;
  v_total_lines int := 0;
  v_sh_up int := 0;
begin
  if p_shipment_id is null then
    return jsonb_build_object('ok', false, 'error', 'p_shipment_id is required');
  end if;

  select s.id, s.cart_id, s.status, s.context, s.deleted_at
    into v_ship
  from public.shipments s
  where s.id = p_shipment_id
  for update;

  if not found or v_ship.deleted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'SHIPMENT_NOT_FOUND');
  end if;

  if v_ship.context is distinct from 'cart_return'::public.shipment_context then
    return jsonb_build_object('ok', false, 'error', 'NOT_CART_RETURN_SHIPMENT');
  end if;

  if v_ship.status = 'closed'::public.shipment_status then
    return jsonb_build_object('ok', true, 'already_closed', true);
  end if;

  if v_ship.status not in ('returned'::public.shipment_status, 'en_verification'::public.shipment_status) then
    return jsonb_build_object('ok', false, 'error', 'BAD_SHIPMENT_STATUS', 'status', v_ship.status::text);
  end if;

  v_cart_id := v_ship.cart_id;

  select c.id, c.user_id, c.status, c.deleted_at
    into v_cart
  from public.carts c
  where c.id = v_cart_id
  for update;

  if not found or v_cart.deleted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'CART_NOT_FOUND');
  end if;

  v_user_id := v_cart.user_id;

  if v_cart.status = 'archived'::public.cart_status then
    update public.shipments s
    set status = 'closed'::public.shipment_status, updated_at = v_now
    where s.id = p_shipment_id
      and s.status in ('returned'::public.shipment_status, 'en_verification'::public.shipment_status);
    get diagnostics v_sh_up = row_count;
    if v_sh_up > 0 then
      perform public.append_shipment_status_history(
        p_shipment_id := p_shipment_id,
        p_to_status := 'closed'::public.shipment_status,
        p_from_status := v_ship.status,
        p_actor_user_id := p_actor_user_id,
        p_reason := 'return_verification_ok — panier déjà archivé, fermeture envoi retour',
        p_source := 'rpc_close_cart_return_verification_ok',
        p_context := jsonb_build_object('branch', 'already_archived_cart'),
        p_occurred_at := v_now
      );
    end if;
    return jsonb_build_object('ok', true, 'already_archived', true);
  end if;

  if v_cart.status is distinct from 'confirmed'::public.cart_status then
    return jsonb_build_object('ok', false, 'error', 'CART_NOT_CONFIRMED', 'status', v_cart.status::text);
  end if;

  select
    count(*) filter (
      where ci.status in (
        'reserved'::public.cart_item_status,
        'verification_pending'::public.cart_item_status
      )
    ),
    count(*) filter (where ci.status = 'rejected'::public.cart_item_status),
    count(*) filter (
      where ci.status = 'verified'::public.cart_item_status
        and i.status is distinct from 'cleaning'::public.item_status
        and not coalesce((ci.return_verification->>'post_clean')::boolean, false)
    ),
    count(*) filter (
      where ci.status = 'verified'::public.cart_item_status
        and (
          i.status = 'cleaning'::public.item_status
          or coalesce((ci.return_verification->>'post_clean')::boolean, false)
        )
    ),
    count(*) filter (where ci.status = 'archived'::public.cart_item_status),
    count(*)
    into v_pending, v_rejected, v_ok_lines, v_post_clean_block, v_archived_lines, v_total_lines
  from public.cart_items ci
  join public.items i on i.id = ci.item_id and i.deleted_at is null
  where ci.cart_id = v_cart_id
    and ci.deleted_at is null
    and ci.status in (
      'reserved'::public.cart_item_status,
      'verification_pending'::public.cart_item_status,
      'verified'::public.cart_item_status,
      'rejected'::public.cart_item_status,
      'archived'::public.cart_item_status
    );

  if v_pending > 0 then
    return jsonb_build_object('ok', false, 'error', 'PENDING_LINES', 'pending', v_pending);
  end if;

  if v_rejected > 0 then
    return jsonb_build_object('ok', false, 'error', 'HAS_DEFECTS', 'rejected', v_rejected);
  end if;

  if v_post_clean_block > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'POST_CLEAN_PIPELINE',
      'post_clean_lines', v_post_clean_block
    );
  end if;

  if v_ok_lines <= 0 then
    if not (v_archived_lines > 0 and v_archived_lines = v_total_lines) then
      return jsonb_build_object('ok', false, 'error', 'NO_VERIFIED_LINES');
    end if;
  end if;

  select
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'exchange_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'exchange' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint),
    coalesce(sum(
      case
        when wt.metadata ? 'debit_split' and jsonb_typeof(wt.metadata -> 'debit_split') = 'object' then
          greatest(0::bigint, coalesce((wt.metadata -> 'debit_split' ->> 'consumption_points')::bigint, 0))
        when lower(trim(coalesce(wt.credit_bucket, ''))) = 'consumption' then greatest(0::bigint, coalesce(wt.amount_points, 0))
        else 0::bigint
      end
    ), 0::bigint)
  into v_ex, v_co
  from public.wallet_transactions wt
  where wt.user_id = v_user_id
    and wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
    and (wt.metadata ->> 'cart_id')::uuid = v_cart_id;

  if not public.user_can_reserve_cart_inventory(v_user_id) then
    v_co := v_co + v_ex;
    v_ex := 0;
  end if;

  if v_ex > 0 or v_co > 0 then
    v_idem_base := format('return_ok:%s', v_cart_id);
    v_key_ex := v_idem_base || ':ex';
    v_key_co := v_idem_base || ':co';

    select uw.id,
      greatest(0::bigint, coalesce(uw.balance_consumption_points, 0)::bigint),
      greatest(0::bigint, coalesce(uw.balance_exchange_points, 0)::bigint)
      into v_wallet_id, v_w_bco, v_w_bex
    from public.user_wallets uw
    where uw.user_id = v_user_id
      and uw.deleted_at is null
    order by uw.updated_at desc
    limit 1
    for update;

    if v_wallet_id is not null then
      if v_ex > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex) then
        insert into public.wallet_transactions (
          user_id,
          kind,
          direction,
          amount_points,
          status,
          idempotency_key,
          credit_bucket,
          metadata
        ) values (
          v_user_id,
          'credit',
          'credit',
          v_ex,
          'posted',
          v_key_ex,
          'exchange',
          jsonb_build_object(
            'source', 'return_verification_ok',
            'cart_id', v_cart_id,
            'shipment_id', p_shipment_id,
            'actor_user_id', p_actor_user_id
          )
        );
        v_did_ex := true;
      end if;

      if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
        insert into public.wallet_transactions (
          user_id,
          kind,
          direction,
          amount_points,
          status,
          idempotency_key,
          credit_bucket,
          metadata
        ) values (
          v_user_id,
          'credit',
          'credit',
          v_co,
          'posted',
          v_key_co,
          'consumption',
          jsonb_build_object(
            'source', 'return_verification_ok',
            'cart_id', v_cart_id,
            'shipment_id', p_shipment_id,
            'actor_user_id', p_actor_user_id
          )
        );
        v_did_co := true;
      end if;

      if v_did_ex or v_did_co then
        update public.user_wallets uw
        set
          balance_consumption_points = uw.balance_consumption_points + case when v_did_co then v_co else 0 end,
          balance_exchange_points = case
            when v_did_ex then greatest(0::bigint, coalesce(uw.balance_exchange_points, 0)::bigint) + v_ex
            else uw.balance_exchange_points
          end,
          updated_at = v_now
        where uw.id = v_wallet_id;
      end if;
    end if;
  end if;

  update public.carts c
  set status = 'archived'::public.cart_status, updated_at = v_now
  where c.id = v_cart_id
    and c.status = 'confirmed'::public.cart_status;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CART_ARCHIVE_CONFLICT');
  end if;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    v_cart_id,
    'confirmed'::public.cart_status,
    'archived'::public.cart_status,
    'return_verification_ok',
    p_actor_user_id
  );

  update public.cart_items ci
  set status = 'archived'::public.cart_item_status, updated_at = v_now
  where ci.cart_id = v_cart_id
    and ci.deleted_at is null
    and ci.status = 'verified'::public.cart_item_status;

  update public.shipments s
  set status = 'closed'::public.shipment_status, updated_at = v_now
  where s.id = p_shipment_id
    and s.status in ('returned'::public.shipment_status, 'en_verification'::public.shipment_status);
  get diagnostics v_sh_up = row_count;
  if v_sh_up > 0 then
    perform public.append_shipment_status_history(
      p_shipment_id := p_shipment_id,
      p_to_status := 'closed'::public.shipment_status,
      p_from_status := v_ship.status,
      p_actor_user_id := p_actor_user_id,
      p_reason := 'return_verification_ok — clôture expédition retour',
      p_source := 'rpc_close_cart_return_verification_ok',
      p_context := jsonb_build_object('branch', 'return_ok'),
      p_occurred_at := v_now
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'archived', true,
    'cart_id', v_cart_id,
    'shipment_id', p_shipment_id
  );
end;
$fn$;

comment on function public.close_cart_return_verification_ok(uuid, uuid) is
  'Retour BO : crédit wallet idempotent, panier archived, expédition closed + historique shipment. service_role uniquement.';

revoke all on function public.close_cart_return_verification_ok(uuid, uuid) from public;
grant execute on function public.close_cart_return_verification_ok(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6) cart_payments_from_wallet_debit : plus de branche mixed
-- ---------------------------------------------------------------------------

create or replace function public.cart_payments_from_wallet_debit()
returns trigger
language plpgsql
security definer
set search_path to public
as $cp$
declare
  v_cart_id uuid;
  v_split jsonb;
  v_ex bigint;
  v_co bigint;
  v_total bigint;
  v_bucket text;
  v_topup bigint;
  v_topup_kind text;
  v_session text;
  v_channel text;
begin
  if new.kind is distinct from 'debit' or new.direction is distinct from 'debit' then
    return new;
  end if;

  if coalesce(new.metadata ->> 'source', '') <> 'cart_order_stripe' then
    return new;
  end if;

  begin
    v_cart_id := (nullif(trim(new.metadata ->> 'cart_id'), ''))::uuid;
  exception
    when others then
      return new;
  end;

  if v_cart_id is null then
    return new;
  end if;

  if not exists (select 1 from public.carts c where c.id = v_cart_id) then
    return new;
  end if;

  v_total := greatest(0, coalesce(new.amount_points, 0)::bigint);
  v_split := new.metadata -> 'debit_split';
  if v_split is not null and jsonb_typeof(v_split) = 'object' then
    v_ex := greatest(0, coalesce(nullif(v_split ->> 'exchange_points', '')::bigint, 0));
    v_co := greatest(0, coalesce(nullif(v_split ->> 'consumption_points', '')::bigint, 0));
  else
    v_ex := 0;
    v_co := 0;
  end if;

  if v_ex + v_co <> v_total then
    v_bucket := lower(coalesce(new.credit_bucket, ''));
    if v_bucket = 'exchange' then
      v_ex := v_total;
      v_co := 0;
    elsif v_bucket = 'consumption' then
      v_ex := 0;
      v_co := v_total;
    else
      v_ex := v_total;
      v_co := 0;
    end if;
  end if;

  v_topup := 0;
  begin
    if new.metadata ? 'stripe_wallet_comp_points' then
      if jsonb_typeof(new.metadata -> 'stripe_wallet_comp_points') = 'number' then
        v_topup := greatest(0, (new.metadata ->> 'stripe_wallet_comp_points')::bigint);
      elsif nullif(trim(new.metadata ->> 'stripe_wallet_comp_points'), '') is not null then
        v_topup := greatest(0, nullif(trim(new.metadata ->> 'stripe_wallet_comp_points'), '')::bigint);
      end if;
    end if;
  exception
    when others then
      v_topup := 0;
  end;

  v_topup_kind := nullif(trim(new.metadata ->> 'stripe_wallet_comp_credits_kind'), '');
  v_session := nullif(trim(new.metadata ->> 'checkout_session_id'), '');

  if new.idempotency_key like 'wallet_only:%' or coalesce(new.metadata ->> 'checkout_mode', '') = 'wallet_only' then
    v_channel := 'wallet_only';
    v_session := null;
  else
    v_channel := 'stripe';
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
    v_cart_id,
    new.user_id,
    new.id,
    v_total,
    v_ex,
    v_co,
    v_topup,
    v_topup_kind,
    v_session,
    v_channel,
    new.idempotency_key,
    coalesce(new.metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$cp$;

-- ---------------------------------------------------------------------------
-- 7) Invité : credit_bucket mixed supprimé du message d’erreur
-- ---------------------------------------------------------------------------

create or replace function public.wallet_transactions_enforce_guest_exchange_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $ge$
declare
  v_can_exchange boolean;
  v_bucket text;
  v_kind text;
  v_src text;
begin
  if new.user_id is null then
    return new;
  end if;

  v_can_exchange := public.user_can_reserve_cart_inventory(new.user_id);
  if v_can_exchange then
    return new;
  end if;

  v_bucket := lower(trim(coalesce(new.credit_bucket, '')));
  v_kind := lower(trim(coalesce(new.metadata ->> 'credits_kind', '')));
  v_src := lower(trim(coalesce(new.metadata ->> 'source', '')));

  if v_bucket = 'exchange' then
    raise exception 'GUEST_WALLET_EXCHANGE_BUCKET_FORBIDDEN'
      using hint = 'credit_bucket exchange is not allowed for guest users';
  end if;

  if new.kind = 'credit' and new.direction = 'credit' then
    if v_kind in ('exchange', 'mods') then
      raise exception 'GUEST_WALLET_EXCHANGE_METADATA_FORBIDDEN'
        using hint = 'credits_kind exchange/mods is not allowed for guest users';
    end if;
    if v_src = 'lend_intake_verified' then
      raise exception 'GUEST_WALLET_LEND_INTAKE_CREDIT_FORBIDDEN'
        using hint = 'lend_intake_verified credits are not allowed for guest users';
    end if;
  end if;

  return new;
end;
$ge$;

-- ---------------------------------------------------------------------------
-- 8) CHECK : plus de valeur mixed
-- ---------------------------------------------------------------------------

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_credit_bucket_check;

alter table public.wallet_transactions
  add constraint wallet_transactions_credit_bucket_check
  check (credit_bucket is null or credit_bucket in ('consumption', 'exchange'));

comment on column public.wallet_transactions.credit_bucket is
  'Seau de points pour la ligne : consommation ou échange (une ligne = un seau ; débit panier mixte = deux lignes).';
