-- Un échange inclus déjà consomé ce mois (bonus guest ou abonnement) compte
-- pour le quota SegnaX / Segna+ : évite un 2ᵉ « 0/1 échange inclus » après upgrade mid-month.

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
  v_bumps_this_month integer := 0;
  v_orders_used_effective integer := 0;
  v_period_month date := date_trunc('month', timezone('utc', now()))::date;
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
    and e.period_month = v_period_month
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

  select count(*)::integer
    into v_bumps_this_month
  from public.cart_monthly_orders_used_bumps b
  where b.user_id = v_uid
    and b.created_at >= v_period_month
    and b.created_at < (v_period_month + interval '1 month');

  v_is_subscriber := v_status in ('active', 'trialing')
    and coalesce(v_plan_code, 'guest') in ('segna_plus', 'segna_x');

  if v_is_subscriber then
    -- Tout bump du mois (bonus pré-abo ou abonnement) consomme le quota mensuel affiché.
    v_orders_used_effective := greatest(coalesce(v_orders_used, 0), coalesce(v_bumps_this_month, 0));
    v_monthly_remaining := greatest(coalesce(v_orders_lim, 0) - v_orders_used_effective, 0);
  else
    v_orders_used_effective := coalesce(v_orders_used, 0);
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
    'orders_used', v_orders_used_effective,
    'lending_points_used', coalesce(v_lending_points_used, 0),
    'bonus_included_orders_remaining', greatest(coalesce(v_bonus_balance, 0), 0),
    'remaining_subscription_orders_this_month', greatest(coalesce(v_monthly_remaining, 0), 0),
    'remaining_orders_this_month', v_total_remaining
  );
end;
$$;

comment on function public.get_current_membership_state() is
  'État abonnement + quotas. Pour abonnés, orders_used / remaining_subscription tiennent compte des bumps d’échange inclus du mois (y compris bonus avant upgrade).';
