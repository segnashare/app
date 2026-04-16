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

