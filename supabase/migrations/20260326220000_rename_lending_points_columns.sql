-- Renommage sémantique : « points inclus » → plafond / usage des points issus des prêts.

drop function if exists public.billing_upsert_monthly_entitlement(uuid, text, date);
drop function if exists public.billing_plan_limits(text);

alter table public.billing_plan_entitlement_limits
  rename column included_points_limit to max_lending_points_limit;

alter table public.user_monthly_entitlements
  rename column included_points_limit to max_lending_points_limit;

alter table public.user_monthly_entitlements
  rename column points_used to lending_points_used;

alter table public.billing_plan_prices
  rename column monthly_included_points to monthly_max_lending_points;

comment on column public.billing_plan_entitlement_limits.max_lending_points_limit is
  'Plafond de points générés par les prêts (plan).';
comment on column public.user_monthly_entitlements.max_lending_points_limit is
  'Plafond mensuel de points issus des prêts pour la période.';
comment on column public.user_monthly_entitlements.lending_points_used is
  'Points issus des prêts déjà comptabilisés sur la période.';
comment on column public.billing_plan_prices.monthly_max_lending_points is
  'Référence produit : plafond de points depuis les prêts pour ce prix Stripe.';

create or replace function public.billing_plan_limits(p_plan_code text)
returns table (included_orders_limit integer, max_lending_points_limit bigint, included_lends_limit integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (select e.included_orders_limit from public.billing_plan_entitlement_limits e where e.plan_code = p_plan_code limit 1),
      0
    ),
    coalesce(
      (select e.max_lending_points_limit from public.billing_plan_entitlement_limits e where e.plan_code = p_plan_code limit 1),
      0::bigint
    ),
    coalesce(
      (select e.included_lends_limit from public.billing_plan_entitlement_limits e where e.plan_code = p_plan_code limit 1),
      0
    );
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
  v_lends integer;
  v_row public.user_monthly_entitlements;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_plan_code is null or p_plan_code not in ('guest', 'segna_plus', 'segna_x') then
    raise exception 'Invalid plan code: %', p_plan_code;
  end if;

  select l.included_orders_limit, l.max_lending_points_limit, l.included_lends_limit
    into v_orders, v_points, v_lends
  from public.billing_plan_limits(p_plan_code) l;

  insert into public.user_monthly_entitlements(
    user_id,
    period_month,
    plan_code,
    included_orders_limit,
    max_lending_points_limit,
    included_lends_limit
  )
  values (
    p_user_id,
    p_period_month,
    p_plan_code,
    v_orders,
    v_points,
    v_lends
  )
  on conflict (user_id, period_month) do update
  set
    plan_code = excluded.plan_code,
    included_orders_limit = excluded.included_orders_limit,
    max_lending_points_limit = excluded.max_lending_points_limit,
    included_lends_limit = excluded.included_lends_limit,
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
    'max_lending_points_limit', coalesce(v_entitlement.max_lending_points_limit, 0),
    'included_lends_limit', coalesce(v_entitlement.included_lends_limit, 0),
    'orders_used', coalesce(v_entitlement.orders_used, 0),
    'lending_points_used', coalesce(v_entitlement.lending_points_used, 0),
    'remaining_orders_this_month', greatest(coalesce(v_entitlement.included_orders_limit, 0) - coalesce(v_entitlement.orders_used, 0), 0),
    'remaining_lending_points_this_month', greatest(coalesce(v_entitlement.max_lending_points_limit, 0) - coalesce(v_entitlement.lending_points_used, 0), 0)
  );
end;
$$;

grant execute on function public.billing_plan_limits(text) to authenticated;
grant execute on function public.billing_upsert_monthly_entitlement(uuid, text, date) to authenticated;
grant execute on function public.get_current_membership_state() to authenticated;
