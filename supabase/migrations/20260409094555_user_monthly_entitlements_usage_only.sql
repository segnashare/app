-- Compteurs mensuels uniquement ; plafonds via billing_plan_entitlement_limits.

drop function if exists public.billing_upsert_monthly_entitlement(uuid, text, date);

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
  v_row public.user_monthly_entitlements;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_plan_code is null or p_plan_code not in ('guest', 'segna_plus', 'segna_x') then
    raise exception 'Invalid plan code: %', p_plan_code;
  end if;

  insert into public.user_monthly_entitlements(
    user_id,
    period_month,
    plan_code
  )
  values (
    p_user_id,
    p_period_month,
    p_plan_code
  )
  on conflict (user_id, period_month) do update
  set
    plan_code = excluded.plan_code,
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
  v_orders_used integer;
  v_lending_points_used bigint;
  v_orders_lim integer;
  v_points_lim bigint;
  v_lends_lim integer;
  v_free_items integer;
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

  select l.included_orders_limit, l.max_lending_points_limit, l.included_lends_limit, l.free_items_per_order
    into v_orders_lim, v_points_lim, v_lends_lim, v_free_items
  from public.billing_plan_limits(coalesce(v_plan_code, 'guest')) l;

  select e.orders_used, e.lending_points_used
    into v_orders_used, v_lending_points_used
  from public.user_monthly_entitlements e
  where e.user_id = v_uid
    and e.period_month = date_trunc('month', timezone('utc', now()))::date
  limit 1;

  return jsonb_build_object(
    'plan_code', coalesce(v_plan_code, 'guest'),
    'subscription_status', coalesce(v_status, 'inactive'),
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'included_orders_limit', coalesce(v_orders_lim, 0),
    'max_lending_points_limit', coalesce(v_points_lim, 0),
    'included_lends_limit', coalesce(v_lends_lim, 0),
    'free_items_per_order', coalesce(v_free_items, 0),
    'orders_used', coalesce(v_orders_used, 0),
    'lending_points_used', coalesce(v_lending_points_used, 0),
    'remaining_orders_this_month', greatest(coalesce(v_orders_lim, 0) - coalesce(v_orders_used, 0), 0),
    'remaining_lending_points_this_month', greatest(coalesce(v_points_lim, 0) - coalesce(v_lending_points_used, 0), 0)
  );
end;
$$;

grant execute on function public.billing_upsert_monthly_entitlement(uuid, text, date) to authenticated;
grant execute on function public.get_current_membership_state() to authenticated;

comment on table public.user_monthly_entitlements is
  'Compteurs d''usage mensuels par utilisateur. Les plafonds viennent de billing_plan_entitlement_limits (billing_plan_limits).'
;

comment on column public.user_monthly_entitlements.orders_used is
  'Nombre de commandes comptabilisées sur la période.';
comment on column public.user_monthly_entitlements.lending_points_used is
  'Points issus des prêts déjà comptabilisés sur la période.';
comment on column public.user_monthly_entitlements.plan_code is
  'Plan associé à la ligne (sync abonnement) ; plafonds effectifs = billing_plan_limits(plan en cours).';

comment on table public.billing_plan_entitlement_limits is
  'Plafonds par plan ; source unique pour billing_plan_limits et enforcement (croisement user_monthly_entitlements).';

alter table public.user_monthly_entitlements
  drop column if exists included_orders_limit,
  drop column if exists max_lending_points_limit,
  drop column if exists included_lends_limit;
