create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.billing_has_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = p_user_id
      and lower(ur.role::text) = lower(p_role)
  );
$$;

create or replace function public.billing_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.billing_has_role(auth.uid(), 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Billing core tables
-- ---------------------------------------------------------------------------

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_customer_id text not null unique,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.billing_plan_prices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider text not null default 'stripe' check (provider in ('stripe')),
  plan_code text not null check (plan_code in ('segna_plus', 'segna_x')),
  stripe_product_id text,
  stripe_price_id text not null unique,
  monthly_included_orders integer not null default 0 check (monthly_included_orders >= 0),
  monthly_included_points bigint not null default 0 check (monthly_included_points >= 0),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, plan_code, stripe_price_id)
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_customer_id text,
  provider_subscription_id text not null unique,
  plan_code text not null default 'guest' check (plan_code in ('guest', 'segna_plus', 'segna_x')),
  status text not null default 'inactive'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'inactive')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  unique (user_id, provider)
);

create table if not exists public.user_monthly_entitlements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null,
  plan_code text not null check (plan_code in ('guest', 'segna_plus', 'segna_x')),
  included_orders_limit integer not null default 0 check (included_orders_limit >= 0),
  included_points_limit bigint not null default 0 check (included_points_limit >= 0),
  orders_used integer not null default 0 check (orders_used >= 0),
  points_used bigint not null default 0 check (points_used >= 0),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, period_month)
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_event_id text not null unique,
  event_type text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error_message text
);

drop trigger if exists trg_billing_customers_updated_at on public.billing_customers;
create trigger trg_billing_customers_updated_at
before update on public.billing_customers
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_plan_prices_updated_at on public.billing_plan_prices;
create trigger trg_billing_plan_prices_updated_at
before update on public.billing_plan_prices
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_subscriptions_updated_at on public.user_subscriptions;
create trigger trg_user_subscriptions_updated_at
before update on public.user_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_monthly_entitlements_updated_at on public.user_monthly_entitlements;
create trigger trg_user_monthly_entitlements_updated_at
before update on public.user_monthly_entitlements
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_webhook_events_updated_at on public.billing_webhook_events;
create trigger trg_billing_webhook_events_updated_at
before update on public.billing_webhook_events
for each row execute function public.set_updated_at();

create index if not exists idx_billing_customers_provider_customer on public.billing_customers(provider_customer_id);
create index if not exists idx_user_subscriptions_user_status on public.user_subscriptions(user_id, status);
create index if not exists idx_user_monthly_entitlements_user_period on public.user_monthly_entitlements(user_id, period_month desc);
create index if not exists idx_billing_webhook_events_provider_type on public.billing_webhook_events(provider, event_type, created_at desc);

-- ---------------------------------------------------------------------------
-- Entitlement helpers
-- ---------------------------------------------------------------------------

create or replace function public.billing_plan_limits(p_plan_code text)
returns table (included_orders_limit integer, included_points_limit bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p_plan_code = 'segna_plus' then 1
      when p_plan_code = 'segna_x' then 2
      else 0
    end as included_orders_limit,
    case
      when p_plan_code = 'segna_plus' then 100::bigint
      when p_plan_code = 'segna_x' then 500::bigint
      else 0::bigint
    end as included_points_limit;
$$;

create or replace function public.billing_upsert_monthly_entitlement(
  p_user_id uuid,
  p_plan_code text,
  p_period_month date default date_trunc('month', timezone('utc', now()))::date
)
returns public.user_monthly_entitlements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders integer;
  v_points bigint;
  v_row public.user_monthly_entitlements;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_plan_code is null or p_plan_code not in ('guest', 'segna_plus', 'segna_x') then
    raise exception 'Invalid plan code: %', p_plan_code;
  end if;

  select l.included_orders_limit, l.included_points_limit
    into v_orders, v_points
  from public.billing_plan_limits(p_plan_code) l;

  insert into public.user_monthly_entitlements(
    user_id,
    period_month,
    plan_code,
    included_orders_limit,
    included_points_limit
  )
  values (
    p_user_id,
    p_period_month,
    p_plan_code,
    v_orders,
    v_points
  )
  on conflict (user_id, period_month) do update
  set
    plan_code = excluded.plan_code,
    included_orders_limit = excluded.included_orders_limit,
    included_points_limit = excluded.included_points_limit,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

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
  v_entitlement public.user_monthly_entitlements%rowtype;
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

  select *
    into v_entitlement
  from public.user_monthly_entitlements e
  where e.user_id = v_uid
    and e.period_month = date_trunc('month', timezone('utc', now()))::date
  limit 1;

  return jsonb_build_object(
    'plan_code', coalesce(v_plan_code, 'guest'),
    'subscription_status', coalesce(v_status, 'inactive'),
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'included_orders_limit', coalesce(v_entitlement.included_orders_limit, 0),
    'included_points_limit', coalesce(v_entitlement.included_points_limit, 0),
    'orders_used', coalesce(v_entitlement.orders_used, 0),
    'points_used', coalesce(v_entitlement.points_used, 0),
    'remaining_orders_this_month', greatest(coalesce(v_entitlement.included_orders_limit, 0) - coalesce(v_entitlement.orders_used, 0), 0),
    'remaining_points_this_month', greatest(coalesce(v_entitlement.included_points_limit, 0) - coalesce(v_entitlement.points_used, 0), 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.billing_customers enable row level security;
alter table public.billing_plan_prices enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.user_monthly_entitlements enable row level security;
alter table public.billing_webhook_events enable row level security;

drop policy if exists "billing_customers_select_own" on public.billing_customers;
create policy "billing_customers_select_own" on public.billing_customers
for select to authenticated
using (user_id = auth.uid() or public.billing_is_admin());

drop policy if exists "billing_customers_admin_all" on public.billing_customers;
create policy "billing_customers_admin_all" on public.billing_customers
for all to authenticated
using (public.billing_is_admin())
with check (public.billing_is_admin());

drop policy if exists "billing_plan_prices_select_auth" on public.billing_plan_prices;
create policy "billing_plan_prices_select_auth" on public.billing_plan_prices
for select to authenticated
using (is_active = true or public.billing_is_admin());

drop policy if exists "billing_plan_prices_admin_all" on public.billing_plan_prices;
create policy "billing_plan_prices_admin_all" on public.billing_plan_prices
for all to authenticated
using (public.billing_is_admin())
with check (public.billing_is_admin());

drop policy if exists "user_subscriptions_select_own" on public.user_subscriptions;
create policy "user_subscriptions_select_own" on public.user_subscriptions
for select to authenticated
using (user_id = auth.uid() or public.billing_is_admin());

drop policy if exists "user_subscriptions_admin_all" on public.user_subscriptions;
create policy "user_subscriptions_admin_all" on public.user_subscriptions
for all to authenticated
using (public.billing_is_admin())
with check (public.billing_is_admin());

drop policy if exists "user_monthly_entitlements_select_own" on public.user_monthly_entitlements;
create policy "user_monthly_entitlements_select_own" on public.user_monthly_entitlements
for select to authenticated
using (user_id = auth.uid() or public.billing_is_admin());

drop policy if exists "user_monthly_entitlements_admin_all" on public.user_monthly_entitlements;
create policy "user_monthly_entitlements_admin_all" on public.user_monthly_entitlements
for all to authenticated
using (public.billing_is_admin())
with check (public.billing_is_admin());

drop policy if exists "billing_webhook_events_admin_all" on public.billing_webhook_events;
create policy "billing_webhook_events_admin_all" on public.billing_webhook_events
for all to authenticated
using (public.billing_is_admin())
with check (public.billing_is_admin());

grant select on public.billing_customers, public.billing_plan_prices, public.user_subscriptions, public.user_monthly_entitlements to authenticated;
grant execute on function public.billing_plan_limits(text) to authenticated;
grant execute on function public.billing_upsert_monthly_entitlement(uuid, text, date) to authenticated;
grant execute on function public.get_current_membership_state() to authenticated;
