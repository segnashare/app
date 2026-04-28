-- La consommation en points n’est plus présentée comme un plafond mensuel distinct du wallet.
-- `remaining_lending_points_this_month` = solde `balance_consumption_points` (points utilisables).
-- `max_lending_points_limit` (JSON) = montant de crédits consommation offerts à chaque renouvellement (config plan).

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

  select coalesce(w.balance_consumption_points, 0)::bigint
    into v_wallet_co
  from public.user_wallets w
  where w.user_id = v_uid
    and w.deleted_at is null
  order by w.updated_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'plan_code', coalesce(v_plan_code, 'guest'),
    'subscription_status', coalesce(v_status, 'inactive'),
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'included_orders_limit', coalesce(v_orders_lim, 0),
    'max_lending_points_limit', coalesce(v_points_lim, 0),
    'monthly_consumption_points_grant', coalesce(v_points_lim, 0),
    'balance_consumption_points_wallet', coalesce(v_wallet_co, 0),
    'included_lends_limit', coalesce(v_lends_lim, 0),
    'free_items_per_order', coalesce(v_free_items, 0),
    'orders_used', coalesce(v_orders_used, 0),
    'lending_points_used', coalesce(v_lending_points_used, 0),
    'remaining_orders_this_month', greatest(coalesce(v_orders_lim, 0) - coalesce(v_orders_used, 0), 0),
    'remaining_lending_points_this_month', greatest(coalesce(v_wallet_co, 0), 0)
  );
end;
$$;

comment on function public.get_current_membership_state() is
  'État abonnement et compteurs mensuels. Points consommation utilisables = solde wallet ; le montant plan est le crédit mensuel offert, pas un second plafond.';

comment on column public.billing_plan_entitlement_limits.max_lending_points_limit is
  'Crédits consommation offerts à chaque renouvellement mensuel (montant du grant). La dépense est limitée par le solde wallet, pas par un deuxième plafond mensuel.';

comment on column public.user_monthly_entitlements.lending_points_used is
  'Héritage : non utilisé pour plafonner les dépenses en points (le wallet fait foi).';

comment on function public.billing_plan_limits(text) is
  'Paramètres effectifs du plan : livraisons incluses, crédits consommation offerts par mois, prêts inclus, articles gratuits par commande.';

comment on table public.billing_plan_entitlement_limits is
  'Configuration par plan : livraisons incluses, montant mensuel de crédits consommation offerts, prêts inclus, etc.';

comment on table public.user_monthly_entitlements is
  'Compteurs d''usage mensuels (ex. commandes). Les dépenses en points consommation suivent le wallet (user_wallets), pas un plafond mensuel séparé ici.';
