-- Complément € checkout panier : paiement Stripe direct, pas crédit wallet.
-- Le débit wallet = total panier − complément Stripe (priorité bonus puis échange).

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
  'Débite le wallet pour la part non couverte par un complément Stripe € (metadata stripe_wallet_comp_points). Priorité bonus puis échange.';

-- cart_payments : le topup Stripe ne doit figurer qu’une fois (ligne exchange ou débit unique).
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

  if coalesce(new.metadata ->> 'cart_debit_component', '') = 'consumption' then
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

  if coalesce(new.metadata ->> 'cart_debit_component', '') = 'exchange' then
    select coalesce(sum(greatest(0, wt.amount_points)), 0)::bigint
      into v_co
    from public.wallet_transactions wt
    where wt.user_id = new.user_id
      and wt.kind = 'debit'
      and wt.direction = 'debit'
      and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
      and coalesce(wt.metadata ->> 'cart_id', '') = v_cart_id::text
      and coalesce(wt.metadata ->> 'cart_debit_component', '') = 'consumption';
    v_total := v_total + v_co;
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
    v_topup := 0;
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

comment on column public.cart_payments.stripe_wallet_topup_points is
  'Points payés en € via Stripe au checkout (complément panier). Ne crédite pas le wallet.';

create or replace function public.get_member_cart_order_checkout_context(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_wallet_debit bigint := 0;
  v_stripe_comp bigint := 0;
  v_session text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select c.user_id
    into v_owner
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'cart_not_found');
  end if;

  if v_owner <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(sum(greatest(0, coalesce(wt.amount_points, 0)::bigint)), 0)::bigint
    into v_wallet_debit
  from public.wallet_transactions wt
  where wt.user_id = v_uid
    and wt.kind = 'debit'
    and wt.direction = 'debit'
    and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
    and nullif(trim(wt.metadata ->> 'cart_id'), '') is not null
    and (wt.metadata ->> 'cart_id')::uuid = p_cart_id;

  select coalesce(max(cp.stripe_wallet_topup_points), 0)::bigint,
         max(nullif(trim(cp.stripe_checkout_session_id), ''))
    into v_stripe_comp, v_session
  from public.cart_payments cp
  where cp.cart_id = p_cart_id
    and cp.user_id = v_uid;

  if v_wallet_debit = 0 and v_stripe_comp = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_debit');
  end if;

  return jsonb_build_object(
    'ok', true,
    'debit_points_total', (v_wallet_debit + v_stripe_comp)::bigint,
    'wallet_topup_points', v_stripe_comp,
    'points_from_lending_balance', v_wallet_debit,
    'checkout_session_id', v_session
  );
end;
$fn$;

comment on function public.get_member_cart_order_checkout_context(uuid) is
  'Membre : répartition panier confirmé — solde wallet débité vs complément Stripe € (sans crédit wallet).';

-- Corrige l’historique : supprime les faux crédits wallet des compléments panier déjà postés.
do $bf$
declare
  r record;
  v_session text;
  v_comp bigint;
  v_remaining bigint;
  d record;
  v_reduce bigint;
  v_new_amt bigint;
begin
  for r in
    select wt.id, wt.user_id, wt.amount_points, wt.credit_bucket, wt.idempotency_key
    from public.wallet_transactions wt
    where wt.kind = 'credit'
      and wt.direction = 'credit'
      and wt.status = 'posted'
      and wt.idempotency_key like 'stripe:cart_order_wallet:%'
  loop
    v_session := replace(r.idempotency_key, 'stripe:cart_order_wallet:', '');
    v_comp := greatest(0, coalesce(r.amount_points, 0)::bigint);
    v_remaining := v_comp;

    for d in
      select wt.id, wt.amount_points, wt.credit_bucket, wt.metadata
      from public.wallet_transactions wt
      where wt.user_id = r.user_id
        and wt.kind = 'debit'
        and wt.direction = 'debit'
        and coalesce(wt.metadata ->> 'source', '') = 'cart_order_stripe'
        and coalesce(wt.metadata ->> 'checkout_session_id', '') = v_session
      order by
        case when lower(coalesce(wt.credit_bucket, '')) = 'consumption' then 0 else 1 end,
        wt.created_at desc
    loop
      exit when v_remaining <= 0;

      if d.amount_points <= v_remaining then
        v_remaining := v_remaining - d.amount_points;
        delete from public.wallet_transactions wt where wt.id = d.id;
      else
        v_reduce := v_remaining;
        v_new_amt := d.amount_points - v_reduce;
        v_remaining := 0;

        update public.wallet_transactions wt
        set
          amount_points = v_new_amt,
          metadata = coalesce(wt.metadata, '{}'::jsonb)
            || jsonb_build_object(
              'debit_split',
              jsonb_build_object(
                'exchange_points',
                case when lower(coalesce(wt.credit_bucket, '')) = 'exchange' then v_new_amt else 0 end,
                'consumption_points',
                case when lower(coalesce(wt.credit_bucket, '')) = 'consumption' then v_new_amt else 0 end
              ),
              'legacy_stripe_topup_debit_normalized', true
            )
        where wt.id = d.id;
      end if;
    end loop;

    if lower(coalesce(r.credit_bucket, '')) = 'exchange' then
      update public.user_wallets uw
      set
        balance_exchange_points = greatest(0::bigint, coalesce(uw.balance_exchange_points, 0::bigint) - v_comp),
        updated_at = timezone('utc', now())
      where uw.user_id = r.user_id
        and uw.deleted_at is null;
    else
      update public.user_wallets uw
      set
        balance_consumption_points = greatest(0::bigint, coalesce(uw.balance_consumption_points, 0::bigint) - v_comp),
        updated_at = timezone('utc', now())
      where uw.user_id = r.user_id
        and uw.deleted_at is null;
    end if;

    delete from public.wallet_transactions wt where wt.id = r.id;
  end loop;
end;
$bf$;
