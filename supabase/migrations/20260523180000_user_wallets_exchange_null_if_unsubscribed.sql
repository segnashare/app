-- `balance_exchange_points` : NULL par défaut pour les utilisateurs sans abonnement actif (Stripe active/trialing).
-- Les abonnés gardent un bigint (0 ou plus). Arithmétique et contraintes utilisent coalesce(..., 0) là où nécessaire.

-- 1) Données existantes : invités avec solde échange à 0 → NULL
update public.user_wallets uw
set balance_exchange_points = null
where coalesce(uw.balance_exchange_points, 0) = 0
  and not exists (
    select 1
    from public.user_subscriptions s
    where s.user_id = uw.user_id
      and s.provider = 'stripe'
      and lower(coalesce(s.status, '')) in ('active', 'trialing')
  );

alter table public.user_wallets
  alter column balance_exchange_points drop default;

alter table public.user_wallets
  alter column balance_exchange_points drop not null;

alter table public.user_wallets
  alter column balance_exchange_points set default null;

comment on column public.user_wallets.balance_exchange_points is
  'Crédits d''échange (prêts validés, compléments échange abonné). NULL si pas d''abonnement Stripe actif/trialing ; 0 ou plus pour les abonnés.';

-- ---------------------------------------------------------------------------
-- Trigger total (inchangé : coalesce sur NULL déjà OK)
-- ---------------------------------------------------------------------------

create or replace function public.user_wallets_sync_balance_points_total()
returns trigger
language plpgsql
as $trg$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.balance_consumption_points, 0) = 0
       and coalesce(new.balance_exchange_points, 0) = 0
       and coalesce(new.balance_points, 0) > 0 then
      new.balance_exchange_points := greatest(0::bigint, coalesce(new.balance_points, 0)::bigint);
      new.balance_consumption_points := 0;
    end if;
  end if;
  new.balance_points :=
    coalesce(new.balance_consumption_points, 0) + coalesce(new.balance_exchange_points, 0);
  return new;
end;
$trg$;

-- ---------------------------------------------------------------------------
-- Bootstrap : wallet invité sans compte échange matérialisé
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_user_after_signup(
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default null,
  p_timezone text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_phone text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email, phone
  into v_email, v_phone
  from auth.users
  where id = v_uid;

  insert into public.users (id, email, phone, first_name, last_name, locale, timezone)
  values (v_uid, v_email, v_phone, p_first_name, p_last_name, p_locale, p_timezone)
  on conflict (id) do update
  set email = excluded.email,
      phone = excluded.phone,
      first_name = coalesce(excluded.first_name, public.users.first_name),
      last_name = coalesce(excluded.last_name, public.users.last_name),
      locale = coalesce(excluded.locale, public.users.locale),
      timezone = coalesce(excluded.timezone, public.users.timezone);

  insert into public.user_roles (user_id, role)
  values (v_uid, 'user')
  on conflict (user_id, role) do nothing;

  insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
  values (v_uid, 0, null)
  on conflict (user_id) do nothing;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  insert into public.onboarding_sessions (user_id, status, current_step, progress)
  values (v_uid, 'in_progress', '/onboarding/welcome', jsonb_build_object('checkpoint', '/onboarding/welcome'))
  on conflict (user_id) do nothing;

  perform public.log_activity_event(
    p_event_name => 'bootstrap_user_after_signup',
    p_payload => jsonb_build_object(
      'first_name', p_first_name,
      'last_name', p_last_name,
      'locale', p_locale,
      'timezone', p_timezone
    ),
    p_request_id => p_request_id
  );

  return public.get_me_context();
end;
$$;

grant execute on function public.bootstrap_user_after_signup(text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- XP : création wallet sans compte échange
-- ---------------------------------------------------------------------------

create or replace function public.xp_grant_rewards_for_event(
  p_user_id uuid,
  p_trigger_event text,
  p_level_no smallint default null,
  p_badge_code text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward record;
  v_granted integer := 0;
  v_wallet_delta numeric(12,2) := 0;
  v_existing boolean;
  v_pts bigint;
begin
  for v_reward in
    select *
    from public.xp_rewards r
    where r.is_active = true
      and r.trigger_event = p_trigger_event
      and (
        (p_trigger_event = 'level_up' and r.level_no = p_level_no)
        or (p_trigger_event = 'badge_awarded' and r.badge_code = p_badge_code)
      )
  loop
    v_existing := false;

    if v_reward.one_time then
      select exists (
        select 1
        from public.activity_events e
        where e.user_id = p_user_id
          and e.event_name = 'xp_reward_granted'
          and e.payload->>'reward_code' = v_reward.reward_code
      ) into v_existing;
    end if;

    if v_existing then
      continue;
    end if;

    if v_reward.reward_type = 'wallet_credit' and coalesce(v_reward.wallet_amount, 0) > 0 then
      v_pts := greatest(0::bigint, trunc(coalesce(v_reward.wallet_amount, 0))::bigint);

      insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
      values (p_user_id, 0, null)
      on conflict (user_id) do nothing;

      update public.user_wallets uw
      set balance_consumption_points = uw.balance_consumption_points + v_pts
      where user_id = p_user_id;

      v_wallet_delta := v_wallet_delta + v_reward.wallet_amount;
    end if;

    insert into public.activity_events (user_id, event_name, payload, request_id)
    values (
      p_user_id,
      'xp_reward_granted',
      jsonb_build_object(
        'reward_code', v_reward.reward_code,
        'trigger_event', p_trigger_event,
        'level_no', p_level_no,
        'badge_code', p_badge_code,
        'reward_type', v_reward.reward_type,
        'wallet_amount', v_reward.wallet_amount
      ),
      p_request_id
    );

    v_granted := v_granted + 1;
  end loop;

  return jsonb_build_object(
    'granted_rewards', v_granted,
    'wallet_delta', v_wallet_delta
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Achat crédits : ne pas transformer NULL en 0 lors d’un crédit consommation seul
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
