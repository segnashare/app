-- Pièces gratuites par commande (au-delà : frais supplémentaires).

drop function if exists public.billing_plan_limits(text);

alter table public.billing_plan_entitlement_limits
  add column if not exists free_items_per_order integer not null default 0
  check (free_items_per_order >= 0);

comment on column public.billing_plan_entitlement_limits.free_items_per_order is
  'Nombre de pièces incluses sans frais supplémentaires par commande.';

update public.billing_plan_entitlement_limits set free_items_per_order = 3 where plan_code = 'segna_plus';
update public.billing_plan_entitlement_limits set free_items_per_order = 5 where plan_code = 'segna_x';

create or replace function public.billing_plan_limits(p_plan_code text)
returns table (
  included_orders_limit integer,
  max_lending_points_limit bigint,
  included_lends_limit integer,
  free_items_per_order integer
)
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
    ),
    coalesce(
      (select e.free_items_per_order from public.billing_plan_entitlement_limits e where e.plan_code = p_plan_code limit 1),
      0
    );
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

  select *
    into v_entitlement
  from public.user_monthly_entitlements e
  where e.user_id = v_uid
    and e.period_month = date_trunc('month', timezone('utc', now()))::date
  limit 1;

  select l.free_items_per_order
    into v_free_items
  from public.billing_plan_limits(coalesce(v_plan_code, 'guest')) l;

  return jsonb_build_object(
    'plan_code', coalesce(v_plan_code, 'guest'),
    'subscription_status', coalesce(v_status, 'inactive'),
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'included_orders_limit', coalesce(v_entitlement.included_orders_limit, 0),
    'max_lending_points_limit', coalesce(v_entitlement.max_lending_points_limit, 0),
    'included_lends_limit', coalesce(v_entitlement.included_lends_limit, 0),
    'free_items_per_order', coalesce(v_free_items, 0),
    'orders_used', coalesce(v_entitlement.orders_used, 0),
    'lending_points_used', coalesce(v_entitlement.lending_points_used, 0),
    'remaining_orders_this_month', greatest(coalesce(v_entitlement.included_orders_limit, 0) - coalesce(v_entitlement.orders_used, 0), 0),
    'remaining_lending_points_this_month', greatest(coalesce(v_entitlement.max_lending_points_limit, 0) - coalesce(v_entitlement.lending_points_used, 0), 0)
  );
end;
$$;

grant execute on function public.billing_plan_limits(text) to authenticated;
grant execute on function public.get_current_membership_state() to authenticated;
