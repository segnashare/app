-- Échanges inclus : compteur persistant (bienvenue, parrainage, bonus) + quota mensuel abonnement.
-- Guest : plus de `included_orders_limit` mensuel sur le plan (→ 0) ; crédits bonus à l'inscription.
-- Abonnement Segna+ / X : conserve le quota mensuel BO + crédits bonus cumulables.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.user_included_order_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_included_order_credits is
  'Solde d''échanges inclus (tous modes livraison). Crédité à l''inscription, par parrainage, etc.';

create table if not exists public.included_order_credit_grants (
  idempotency_key text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists included_order_credit_grants_user_id_idx
  on public.included_order_credit_grants (user_id);

alter table public.user_included_order_credits enable row level security;
alter table public.included_order_credit_grants enable row level security;

alter table public.cart_monthly_orders_used_bumps
  add column if not exists consumption_kind text
  check (consumption_kind is null or consumption_kind in ('subscription_monthly', 'bonus', 'legacy_monthly'));

comment on column public.cart_monthly_orders_used_bumps.consumption_kind is
  'Source de l''inclusion consommée : quota abonnement ou crédit bonus.';

-- ---------------------------------------------------------------------------
-- Grant idempotent
-- ---------------------------------------------------------------------------

create or replace function public.grant_user_included_order_credit(
  p_user_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer := greatest(0, coalesce(p_amount, 0));
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_new text;
begin
  if p_user_id is null or v_amount <= 0 or v_key is null then
    return false;
  end if;

  insert into public.included_order_credit_grants (idempotency_key, user_id, amount, metadata)
  values (v_key, p_user_id, v_amount, coalesce(p_metadata, '{}'::jsonb))
  on conflict (idempotency_key) do nothing
  returning idempotency_key into v_new;

  if v_new is null then
    return false;
  end if;

  insert into public.user_included_order_credits (user_id, balance)
  values (p_user_id, v_amount)
  on conflict (user_id) do update
  set
    balance = public.user_included_order_credits.balance + excluded.balance,
    updated_at = now();

  return true;
end;
$$;

comment on function public.grant_user_included_order_credit(uuid, integer, text, jsonb) is
  'Crédite le compteur d''échanges inclus (idempotent via idempotency_key).';

revoke all on function public.grant_user_included_order_credit(uuid, integer, text, jsonb) from public;
grant execute on function public.grant_user_included_order_credit(uuid, integer, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Consommation à la confirmation panier (remplace la logique bump mensuelle guest)
-- ---------------------------------------------------------------------------

create or replace function public.confirm_cart_try_monthly_orders_used_bump(
  p_cart_id uuid,
  p_user_id uuid,
  p_used_included_order boolean default false
)
returns void
language plpgsql
security definer
set search_path to public
as $bump$
declare
  v_new uuid;
  v_sub_plan text;
  v_sub_status text;
  v_period_month date := date_trunc('month', timezone('utc', now()))::date;
  v_orders_lim integer := 0;
  v_orders_used integer := 0;
  v_monthly_remaining integer := 0;
  v_bonus_balance integer := 0;
  v_kind text;
begin
  if p_cart_id is null or p_user_id is null then
    return;
  end if;

  if not coalesce(p_used_included_order, false) then
    return;
  end if;

  insert into public.cart_monthly_orders_used_bumps (cart_id, user_id, consumption_kind)
  values (p_cart_id, p_user_id, null)
  on conflict (cart_id) do nothing
  returning cart_id into v_new;

  if v_new is null then
    return;
  end if;

  select coalesce(c.balance, 0)
    into v_bonus_balance
  from public.user_included_order_credits c
  where c.user_id = p_user_id;

  select s.plan_code, s.status
    into v_sub_plan, v_sub_status
  from public.user_subscriptions s
  where s.user_id = p_user_id
    and s.provider = 'stripe'
  order by s.updated_at desc
  limit 1;

  if v_sub_status in ('active', 'trialing')
     and v_sub_plan in ('segna_plus', 'segna_x') then
    select l.included_orders_limit
      into v_orders_lim
    from public.billing_plan_limits(v_sub_plan) l;

    perform public.billing_upsert_monthly_entitlement(p_user_id, v_sub_plan, v_period_month);

    select coalesce(e.orders_used, 0)
      into v_orders_used
    from public.user_monthly_entitlements e
    where e.user_id = p_user_id
      and e.period_month = v_period_month;

    v_monthly_remaining := greatest(coalesce(v_orders_lim, 0) - coalesce(v_orders_used, 0), 0);

    if v_monthly_remaining > 0 then
      v_kind := 'subscription_monthly';
      update public.user_monthly_entitlements e
      set
        orders_used = e.orders_used + 1,
        updated_at = now()
      where e.user_id = p_user_id
        and e.period_month = v_period_month;

      update public.cart_monthly_orders_used_bumps
      set consumption_kind = v_kind
      where cart_id = p_cart_id;

      return;
    end if;
  end if;

  if coalesce(v_bonus_balance, 0) <= 0 then
    delete from public.cart_monthly_orders_used_bumps where cart_id = p_cart_id;
    return;
  end if;

  update public.user_included_order_credits
  set
    balance = greatest(0, balance - 1),
    updated_at = now()
  where user_id = p_user_id
    and balance > 0;

  update public.cart_monthly_orders_used_bumps
  set consumption_kind = 'bonus'
  where cart_id = p_cart_id;
end;
$bump$;

comment on function public.confirm_cart_try_monthly_orders_used_bump(uuid, uuid, boolean) is
  'Consomme 1 échange inclus si le checkout l''a appliqué : quota abonnement mensuel en priorité, sinon crédit bonus.';

-- ---------------------------------------------------------------------------
-- État membre
-- ---------------------------------------------------------------------------

create or replace function public.get_current_membership_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_plan_code text := 'guest';
  v_status text := 'inactive';
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_orders_used integer;
  v_lending_points_used bigint;
  v_orders_lim integer;
  v_points_lim bigint;
  v_lends_lim integer;
  v_free_items integer;
  v_wallet_co bigint;
  v_bonus_balance integer := 0;
  v_monthly_remaining integer := 0;
  v_total_remaining integer := 0;
  v_is_subscriber boolean := false;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select s.plan_code, s.status, s.current_period_start, s.current_period_end
    into v_plan_code, v_status, v_period_start, v_period_end
  from public.user_subscriptions s
  where s.user_id = v_uid
    and s.provider = 'stripe'
  order by s.updated_at desc
  limit 1;

  select l.included_orders_limit, l.monthly_consumption_points_grant, l.included_lends_limit, l.free_items_per_order
    into v_orders_lim, v_points_lim, v_lends_lim, v_free_items
  from public.billing_plan_limits(coalesce(v_plan_code, 'guest')) l;

  select e.orders_used, e.lending_points_used
    into v_orders_used, v_lending_points_used
  from public.user_monthly_entitlements e
  where e.user_id = v_uid
    and e.period_month = date_trunc('month', timezone('utc', now()))::date
  limit 1;

  select coalesce(w.balance_consumption_points, 0)::bigint
    into v_wallet_co
  from public.user_wallets w
  where w.user_id = v_uid
    and w.deleted_at is null
  order by w.updated_at desc nulls last
  limit 1;

  select coalesce(c.balance, 0)
    into v_bonus_balance
  from public.user_included_order_credits c
  where c.user_id = v_uid;

  v_is_subscriber := v_status in ('active', 'trialing')
    and coalesce(v_plan_code, 'guest') in ('segna_plus', 'segna_x');

  if v_is_subscriber then
    v_monthly_remaining := greatest(coalesce(v_orders_lim, 0) - coalesce(v_orders_used, 0), 0);
  end if;

  v_total_remaining := greatest(coalesce(v_bonus_balance, 0), 0) + greatest(coalesce(v_monthly_remaining, 0), 0);

  return jsonb_build_object(
    'plan_code', coalesce(v_plan_code, 'guest'),
    'subscription_status', coalesce(v_status, 'inactive'),
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'included_orders_limit', case when v_is_subscriber then coalesce(v_orders_lim, 0) else coalesce(v_bonus_balance, 0) end,
    'monthly_consumption_points_grant', coalesce(v_points_lim, 0),
    'balance_consumption_points_wallet', coalesce(v_wallet_co, 0),
    'included_lends_limit', coalesce(v_lends_lim, 0),
    'free_items_per_order', coalesce(v_free_items, 0),
    'orders_used', coalesce(v_orders_used, 0),
    'lending_points_used', coalesce(v_lending_points_used, 0),
    'bonus_included_orders_remaining', greatest(coalesce(v_bonus_balance, 0), 0),
    'remaining_subscription_orders_this_month', greatest(coalesce(v_monthly_remaining, 0), 0),
    'remaining_orders_this_month', v_total_remaining
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Bienvenue : 1 échange inclus à l'inscription
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_user_after_signup(
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default null,
  p_timezone text default null,
  p_request_id uuid default null,
  p_referral_code text default null
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
  v_ref_raw text;
  v_ref_lower text;
  v_rc_id uuid;
  v_referrer uuid;
  v_referral_pending boolean := false;
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
  values (v_uid, 'in_progress', '/onboarding/1', jsonb_build_object('checkpoint', '/onboarding/1'))
  on conflict (user_id) do nothing;

  perform public.grant_user_included_order_credit(
    v_uid,
    1,
    'welcome_included_order:' || v_uid::text,
    jsonb_build_object('source', 'welcome_signup')
  );

  v_ref_raw := trim(coalesce(p_referral_code, ''));
  if length(v_ref_raw) > 0 then
    v_ref_lower := lower(v_ref_raw);
    select rc.id, rc.user_id
    into v_rc_id, v_referrer
    from public.referrals_codes rc
    where rc.is_active is true
      and lower(rc.code) = v_ref_lower
    limit 1;

    if v_rc_id is not null and v_referrer is distinct from v_uid then
      if not exists (select 1 from public.referrals r where r.referred_user_id = v_uid) then
        update public.users u
        set pending_referral_code = v_ref_raw
        where u.id = v_uid;
        v_referral_pending := true;
      end if;
    end if;
  end if;

  perform public.log_activity_event(
    'bootstrap_user_after_signup',
    jsonb_build_object(
      'first_name', p_first_name,
      'last_name', p_last_name,
      'locale', p_locale,
      'timezone', p_timezone,
      'referral_code_param', nullif(v_ref_raw, ''),
      'referral_pending_capture', v_referral_pending
    ),
    p_request_id
  );

  return public.get_me_context();
end;
$$;

-- ---------------------------------------------------------------------------
-- Parrainage : +1 échange inclus pour la marraine (sans crédits wallet)
-- ---------------------------------------------------------------------------

create or replace function public.qualify_pending_referral(
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_pending text;
  v_ref_lower text;
  v_rc_id uuid;
  v_referrer uuid;
  v_rc_text text;
  v_bonus constant bigint := 0;
  v_referral_id uuid;
  v_referred_display text;
  v_phone_ok boolean;
  v_onboarding_done boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.referrals r where r.referred_user_id = v_uid) then
    update public.users u set pending_referral_code = null where u.id = v_uid and u.pending_referral_code is not null;
    return jsonb_build_object('qualified', false, 'reason', 'already_referred');
  end if;

  select nullif(trim(u.pending_referral_code), '')
  into v_pending
  from public.users u
  where u.id = v_uid;

  if v_pending is null or length(v_pending) = 0 then
    return jsonb_build_object('qualified', false, 'reason', 'no_pending_code');
  end if;

  select
    coalesce(
      (u.phone is not null and length(trim(u.phone)) > 0)
      and exists (
        select 1
        from auth.users au
        where au.id = u.id
          and au.phone is not null
          and trim(au.phone) <> ''
          and au.phone_confirmed_at is not null
      ),
      false
    )
  into v_phone_ok
  from public.users u
  where u.id = v_uid;

  if not coalesce(v_phone_ok, false) then
    return jsonb_build_object('qualified', false, 'reason', 'phone_not_verified');
  end if;

  select
    exists (
      select 1
      from public.onboarding_sessions os
      where os.user_id = v_uid
        and os.status = 'completed'
    )
    or exists (
      select 1
      from public.users u2
      where u2.id = v_uid
        and u2.onboarding_completed_at is not null
    )
  into v_onboarding_done;

  if not coalesce(v_onboarding_done, false) then
    return jsonb_build_object('qualified', false, 'reason', 'onboarding_incomplete');
  end if;

  v_ref_lower := lower(v_pending);
  select rc.id, rc.user_id, rc.code
  into v_rc_id, v_referrer, v_rc_text
  from public.referrals_codes rc
  where rc.is_active is true
    and lower(rc.code) = v_ref_lower
  limit 1;

  if v_rc_id is null or v_referrer is not distinct from v_uid then
    update public.users u set pending_referral_code = null where u.id = v_uid;
    return jsonb_build_object('qualified', false, 'reason', 'invalid_or_self_referral');
  end if;

  begin
    insert into public.referrals (
      referrer_user_id,
      referred_user_id,
      referral_code_id,
      referral_code,
      status,
      source_type,
      source_id,
      qualified_at,
      request_id,
      metadata
    )
    values (
      v_referrer,
      v_uid,
      v_rc_id,
      v_rc_text,
      'qualified',
      'invite_link',
      v_pending,
      now(),
      p_request_id,
      jsonb_build_object('bonus_consumption_points_each', v_bonus, 'qualified_via', 'deferred')
    )
    returning id into v_referral_id;

    v_referred_display := coalesce(
      nullif(trim((select u3.first_name from public.users u3 where u3.id = v_uid)), ''),
      nullif(
        initcap(split_part(trim(coalesce((select au.email from auth.users au where au.id = v_uid), '')), '@', 1)),
        ''
      ),
      'Ton invitée'
    );

    perform public.grant_user_included_order_credit(
      v_referrer,
      1,
      'referral_included_order:' || v_referral_id::text || ':referrer',
      jsonb_build_object('source', 'referral_signup', 'referral_id', v_referral_id, 'role', 'referrer')
    );

    update public.users u
    set referrer_bonus_modal = jsonb_build_object(
      'referred_display_name', v_referred_display,
      'points', 0,
      'referral_id', v_referral_id,
      'referred_user_id', v_uid
    )
    where u.id = v_referrer;

    update public.users u
    set pending_referral_code = null
    where u.id = v_uid;

    perform public.log_activity_event(
      'referral_qualified_deferred',
      jsonb_build_object(
        'referral_id', v_referral_id,
        'referrer_user_id', v_referrer,
        'referred_user_id', v_uid
      ),
      p_request_id
    );

    return jsonb_build_object('qualified', true, 'referral_id', v_referral_id);
  exception
    when unique_violation then
      update public.users u set pending_referral_code = null where u.id = v_uid;
      return jsonb_build_object('qualified', false, 'reason', 'unique_violation');
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plan Guest : plus de quota mensuel BO (crédits bonus à part)
-- ---------------------------------------------------------------------------

update public.billing_plan_entitlement_limits
set
  included_orders_limit = 0,
  updated_at = timezone('utc', now())
where plan_code = 'guest';

-- Backfill : 1 échange inclus pour les comptes sans commande confirmée (si pas déjà crédité).
insert into public.user_included_order_credits (user_id, balance)
select
  u.id,
  case
    when exists (
      select 1
      from public.carts c
      where c.user_id = u.id
        and c.deleted_at is null
        and c.status in ('confirmed'::public.cart_status, 'archived'::public.cart_status)
    ) then 0
    else 1
  end
from auth.users u
where not exists (
  select 1
  from public.included_order_credit_grants g
  where g.idempotency_key = 'welcome_included_order:' || u.id::text
)
on conflict (user_id) do nothing;

insert into public.included_order_credit_grants (idempotency_key, user_id, amount, metadata)
select
  'welcome_included_order:' || u.id::text,
  u.id,
  c.balance,
  jsonb_build_object('source', 'welcome_signup_backfill')
from public.user_included_order_credits c
join auth.users u on u.id = c.user_id
where c.balance > 0
  and not exists (
    select 1
    from public.included_order_credit_grants g
    where g.idempotency_key = 'welcome_included_order:' || u.id::text
  )
on conflict (idempotency_key) do nothing;

-- ---------------------------------------------------------------------------
-- confirm_cart_paid_from_stripe : paramètre p_used_included_order
-- (corps aligné sur 202605191200 + bump paramétré)
-- ---------------------------------------------------------------------------

create or replace function public.confirm_cart_paid_from_stripe(
  p_cart_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_delivery_channel text,
  p_relay_point_id text,
  p_delivery_line1 text,
  p_return_relay_point_id text default null,
  p_return_relay_label text default null,
  p_return_relay_search_postal_code text default null,
  p_used_included_order boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status public.cart_status;
  v_ship_id uuid;
  v_channel text := lower(coalesce(nullif(trim(p_delivery_channel), ''), 'relay'));
  v_dest_meta jsonb;
begin
  if p_cart_id is null or p_user_id is null then
    raise exception 'cart_id and user_id are required';
  end if;

  v_dest_meta := jsonb_build_object(
    'stripe_checkout_session_id', p_checkout_session_id,
    'source', 'stripe_cart_order'
  );
  if coalesce(nullif(trim(p_return_relay_point_id), ''), '') <> '' then
    v_dest_meta := v_dest_meta || jsonb_strip_nulls(
      jsonb_build_object(
        'return_relay_code', nullif(trim(p_return_relay_point_id), ''),
        'return_relay_label', nullif(trim(p_return_relay_label), ''),
        'return_relay_search_postal_code', nullif(trim(p_return_relay_search_postal_code), '')
      )
    );
  end if;

  select c.status
    into v_status
  from public.carts c
  where c.id = p_cart_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'Cart not found';
  end if;

  if exists (
    select 1
    from public.carts c
    where c.id = p_cart_id
      and c.user_id is distinct from p_user_id
  ) then
    raise exception 'Forbidden: cart does not belong to user';
  end if;

  if v_status = 'confirmed'::public.cart_status then
    update public.cart_items ci
    set
      status = 'reserved'::public.cart_item_status,
      updated_at = now()
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null
      and ci.status in (
        'in_cart'::public.cart_item_status,
        'reservation_pending'::public.cart_item_status,
        'reserved'::public.cart_item_status
      );

    update public.items i
    set
      status = 'reserved'::public.item_status,
      updated_at = now()
    from public.cart_items ci
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null
      and ci.item_id = i.id
      and i.deleted_at is null
      and ci.status = 'reserved'::public.cart_item_status;

    if coalesce(nullif(trim(p_return_relay_point_id), ''), '') <> '' then
      update public.shipment_destinations sd
      set
        metadata = coalesce(sd.metadata, '{}'::jsonb) || jsonb_strip_nulls(
          jsonb_build_object(
            'return_relay_code', nullif(trim(p_return_relay_point_id), ''),
            'return_relay_label', nullif(trim(p_return_relay_label), ''),
            'return_relay_search_postal_code', nullif(trim(p_return_relay_search_postal_code), '')
          )
        ),
        updated_at = now()
      from public.shipments s
      where sd.shipment_id = s.id
        and s.cart_id = p_cart_id
        and s.context = 'cart_outbound'::public.shipment_context
        and s.deleted_at is null;
    end if;

    perform public.confirm_cart_try_monthly_orders_used_bump(p_cart_id, p_user_id, p_used_included_order);

    return jsonb_build_object(
      'ok', true,
      'already_confirmed', true,
      'cart_id', p_cart_id
    );
  end if;

  if v_status is distinct from 'checkout_pending'::public.cart_status
     and v_status is distinct from 'active'::public.cart_status then
    raise exception 'Cart cannot be confirmed from status: %', v_status;
  end if;

  delete from public.item_inventory_locks il
  where il.cart_id = p_cart_id;

  update public.carts c
  set
    status = 'confirmed'::public.cart_status,
    locked_until = null,
    updated_at = now()
  where c.id = p_cart_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (
    p_cart_id,
    v_status,
    'confirmed'::public.cart_status,
    'stripe_checkout_paid',
    p_user_id
  );

  update public.cart_items ci
  set
    status = 'reserved'::public.cart_item_status,
    updated_at = now()
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.status in (
      'in_cart'::public.cart_item_status,
      'reservation_pending'::public.cart_item_status,
      'reserved'::public.cart_item_status
    );

  update public.items i
  set
    status = 'reserved'::public.item_status,
    updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id
    and ci.deleted_at is null
    and ci.item_id = i.id
    and i.deleted_at is null
    and ci.status = 'reserved'::public.cart_item_status;

  if not exists (
    select 1
    from public.shipments s
    where s.cart_id = p_cart_id
      and s.context = 'cart_outbound'::public.shipment_context
      and s.deleted_at is null
  ) then
    insert into public.shipments (cart_id, context, status)
    values (p_cart_id, 'cart_outbound'::public.shipment_context, 'pending'::public.shipment_status)
    returning id into v_ship_id;

    insert into public.shipment_items (shipment_id, cart_item_id)
    select v_ship_id, ci.id
    from public.cart_items ci
    where ci.cart_id = p_cart_id
      and ci.deleted_at is null;

    if v_channel = 'relay' and coalesce(nullif(trim(p_relay_point_id), ''), '') <> '' then
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        provider_point_id,
        metadata
      )
      values (
        v_ship_id,
        'pickup_point'::public.shipment_destination_type,
        nullif(trim(p_relay_point_id), ''),
        v_dest_meta
      );
    elsif v_channel = 'home' then
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        line1,
        metadata
      )
      values (
        v_ship_id,
        'home'::public.shipment_destination_type,
        coalesce(nullif(trim(p_delivery_line1), ''), 'Livraison à domicile (checkout)'),
        v_dest_meta
      );
    else
      insert into public.shipment_destinations (
        shipment_id,
        destination_type,
        provider_point_id,
        metadata
      )
      values (
        v_ship_id,
        'pickup_point'::public.shipment_destination_type,
        null,
        v_dest_meta || jsonb_build_object('note', 'relay_point_missing')
      );
    end if;
  end if;

  perform public.log_activity_event_rpc(
    'cart_confirmed_stripe',
    'stripe_checkout_paid',
    p_user_id,
    'cart'::public.activity_resource_type,
    'cart',
    p_cart_id,
    'info'::public.activity_severity,
    jsonb_build_object(
      'cart_id', p_cart_id,
      'checkout_session_id', p_checkout_session_id,
      'delivery_channel', v_channel,
      'used_included_order', coalesce(p_used_included_order, false)
    ),
    null
  );

  perform public.confirm_cart_try_monthly_orders_used_bump(p_cart_id, p_user_id, p_used_included_order);

  return jsonb_build_object(
    'ok', true,
    'cart_id', p_cart_id,
    'shipment_id', v_ship_id
  );
end;
$fn$;

revoke all on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.confirm_cart_paid_from_stripe(uuid, uuid, text, text, text, text, text, text, text, boolean) to service_role;

-- Annulation : restaurer crédit bonus ou quota mensuel selon consumption_kind
create or replace function public.revert_cart_included_order_consumption(p_cart_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_period_month date := date_trunc('month', timezone('utc', now()))::date;
begin
  select b.consumption_kind
    into v_kind
  from public.cart_monthly_orders_used_bumps b
  where b.cart_id = p_cart_id
    and b.user_id = p_user_id;

  if not found then
    return;
  end if;

  if v_kind = 'bonus' then
    insert into public.user_included_order_credits (user_id, balance)
    values (p_user_id, 1)
    on conflict (user_id) do update
    set balance = public.user_included_order_credits.balance + 1, updated_at = now();
  elsif v_kind in ('subscription_monthly', 'legacy_monthly') or v_kind is null then
    update public.user_monthly_entitlements e
    set
      orders_used = greatest(0, e.orders_used - 1),
      updated_at = now()
    where e.user_id = p_user_id
      and e.period_month = v_period_month
      and e.orders_used > 0;
  end if;

  delete from public.cart_monthly_orders_used_bumps b
  where b.cart_id = p_cart_id
    and b.user_id = p_user_id;
end;
$$;

revoke all on function public.revert_cart_included_order_consumption(uuid, uuid) from public;
grant execute on function public.revert_cart_included_order_consumption(uuid, uuid) to service_role;

-- Annulation : restaurer crédit bonus ou quota mensuel
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

  if v_ship_status not in (
    'pending'::public.shipment_status,
    'ready'::public.shipment_status
  ) then
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
      v_uid, 'credit', 'credit', v_ex, 'posted', v_key_ex,
      jsonb_build_object('source', 'cart_order_cancel', 'cart_id', p_cart_id, 'refunds_debit_wallet_tx', v_debit_anchor_id, 'credits_kind', 'exchange'),
      'exchange'
    );
    v_did_ex := true;
  end if;

  if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_uid, 'credit', 'credit', v_co, 'posted', v_key_co,
      jsonb_build_object('source', 'cart_order_cancel', 'cart_id', p_cart_id, 'refunds_debit_wallet_tx', v_debit_anchor_id, 'credits_kind', 'consumption'),
      'consumption'
    );
    v_did_co := true;
  end if;

  if v_did_ex or v_did_co then
    update public.user_wallets uw
    set
      balance_exchange_points = case when v_did_ex then coalesce(uw.balance_exchange_points, 0) + v_ex else uw.balance_exchange_points end,
      balance_consumption_points = case when v_did_co then uw.balance_consumption_points + v_co else uw.balance_consumption_points end,
      updated_at = now()
    where uw.id = (select id from public.user_wallets where user_id = v_uid and deleted_at is null order by updated_at desc limit 1)
    returning uw.id into v_wallet_id;

    if v_wallet_id is null then
      insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
      values (v_uid, case when v_did_co then v_co else 0 end, case when v_did_ex then v_ex else null end)
      returning id into v_wallet_id;
    end if;
  end if;

  update public.items i
  set status = 'available'::public.item_status, updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id and ci.deleted_at is null and ci.item_id = i.id and i.deleted_at is null and i.status = 'reserved'::public.item_status;

  update public.cart_items ci
  set status = 'archived'::public.cart_item_status, updated_at = now()
  where ci.cart_id = p_cart_id and ci.deleted_at is null;

  update public.shipments s
  set status = 'closed'::public.shipment_status, updated_at = now()
  where s.id = v_ship_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (p_cart_id, 'confirmed'::public.cart_status, 'canceled'::public.cart_status, 'member_cancel_pending_preparation', v_uid);

  update public.carts c
  set status = 'canceled'::public.cart_status, locked_until = null, updated_at = now()
  where c.id = p_cart_id;

  perform public.revert_cart_included_order_consumption(p_cart_id, v_uid);

  return jsonb_build_object('ok', true, 'cart_id', p_cart_id, 'refunded_exchange_points', v_ex, 'refunded_consumption_points', v_co);
end;
$fn$;

-- Back-office : même restauration bonus / quota mensuel
create or replace function public.backoffice_cancel_cart_order_pending_preparation(
  p_cart_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
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
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'FORBIDDEN_NOT_SERVICE_ROLE';
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

  if v_cart_status = 'canceled'::public.cart_status then
    return jsonb_build_object('ok', true, 'already_canceled', true, 'cart_id', p_cart_id);
  end if;

  if v_cart_status is distinct from 'confirmed'::public.cart_status then
    raise exception 'CART_NOT_CANCELLABLE_STATUS:%', v_cart_status;
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
  where wt.user_id = v_owner
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

  if not public.user_can_reserve_cart_inventory(v_owner) then
    v_co := v_co + v_ex;
    v_ex := 0;
  end if;

  v_key_ex := format('cart_order_cancel_refund_ex:%s', p_cart_id);
  v_key_co := format('cart_order_cancel_refund_co:%s', p_cart_id);

  if v_ex > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_ex) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_owner, 'credit', 'credit', v_ex, 'posted', v_key_ex,
      jsonb_build_object('source', 'cart_order_cancel', 'cart_id', p_cart_id, 'refunds_debit_wallet_tx', v_debit_anchor_id, 'credits_kind', 'exchange'),
      'exchange'
    );
    v_did_ex := true;
  end if;

  if v_co > 0 and not exists (select 1 from public.wallet_transactions wt where wt.idempotency_key = v_key_co) then
    insert into public.wallet_transactions (
      user_id, kind, direction, amount_points, status, idempotency_key, metadata, credit_bucket
    ) values (
      v_owner, 'credit', 'credit', v_co, 'posted', v_key_co,
      jsonb_build_object('source', 'cart_order_cancel', 'cart_id', p_cart_id, 'refunds_debit_wallet_tx', v_debit_anchor_id, 'credits_kind', 'consumption'),
      'consumption'
    );
    v_did_co := true;
  end if;

  if v_did_ex or v_did_co then
    update public.user_wallets uw
    set
      balance_exchange_points = case when v_did_ex then coalesce(uw.balance_exchange_points, 0) + v_ex else uw.balance_exchange_points end,
      balance_consumption_points = case when v_did_co then uw.balance_consumption_points + v_co else uw.balance_consumption_points end,
      updated_at = now()
    where uw.id = (select id from public.user_wallets where user_id = v_owner and deleted_at is null order by updated_at desc limit 1)
    returning uw.id into v_wallet_id;

    if v_wallet_id is null then
      insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
      values (v_owner, case when v_did_co then v_co else 0 end, case when v_did_ex then v_ex else null end)
      returning id into v_wallet_id;
    end if;
  end if;

  update public.items i
  set status = 'available'::public.item_status, updated_at = now()
  from public.cart_items ci
  where ci.cart_id = p_cart_id and ci.deleted_at is null and ci.item_id = i.id and i.deleted_at is null and i.status = 'reserved'::public.item_status;

  update public.cart_items ci
  set status = 'archived'::public.cart_item_status, updated_at = now()
  where ci.cart_id = p_cart_id and ci.deleted_at is null;

  update public.shipments s
  set status = 'closed'::public.shipment_status, updated_at = now()
  where s.id = v_ship_id;

  insert into public.cart_status_history (cart_id, from_status, to_status, reason, actor_user_id)
  values (p_cart_id, 'confirmed'::public.cart_status, 'canceled'::public.cart_status, 'backoffice_cancel_pending_preparation', p_actor_user_id);

  update public.carts c
  set status = 'canceled'::public.cart_status, locked_until = null, updated_at = now()
  where c.id = p_cart_id;

  perform public.revert_cart_included_order_consumption(p_cart_id, v_owner);

  return jsonb_build_object('ok', true, 'cart_id', p_cart_id, 'refunded_exchange_points', v_ex, 'refunded_consumption_points', v_co);
end;
$fn$;
