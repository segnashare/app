-- Plafond de prêts concurrents par plan (Membre + / Membre X), stocké sur la ligne mensuelle.

alter table public.user_monthly_entitlements
  add column if not exists included_lends_limit integer not null default 0
  check (included_lends_limit >= 0);

comment on column public.user_monthly_entitlements.included_lends_limit is
  'Nombre max de pièces en prêt simultané pour la période (aligné sur le plan).';

-- Dépendance : recréer billing_upsert après billing_plan_limits.
drop function if exists public.billing_upsert_monthly_entitlement(uuid, text, date);

-- Étend billing_plan_limits : plafonds prêts (5 = Segna+, 10 = Segna X).
drop function if exists public.billing_plan_limits(text);

create or replace function public.billing_plan_limits(p_plan_code text)
returns table (included_orders_limit integer, included_points_limit bigint, included_lends_limit integer)
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
    end as included_points_limit,
    case
      when p_plan_code = 'segna_plus' then 5
      when p_plan_code = 'segna_x' then 10
      else 0
    end as included_lends_limit;
$$;

-- Recréer billing_upsert_monthly_entitlement pour inclure included_lends_limit.
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

  select l.included_orders_limit, l.included_points_limit, l.included_lends_limit
    into v_orders, v_points, v_lends
  from public.billing_plan_limits(p_plan_code) l;

  insert into public.user_monthly_entitlements(
    user_id,
    period_month,
    plan_code,
    included_orders_limit,
    included_points_limit,
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
    included_points_limit = excluded.included_points_limit,
    included_lends_limit = excluded.included_lends_limit,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Backfill lignes existantes (valeurs par plan).
update public.user_monthly_entitlements
set included_lends_limit = case plan_code
  when 'segna_plus' then 5
  when 'segna_x' then 10
  else 0
end
where included_lends_limit = 0;

-- get_current_membership_state : exposer le plafond prêts.
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
    'included_lends_limit', coalesce(v_entitlement.included_lends_limit, 0),
    'orders_used', coalesce(v_entitlement.orders_used, 0),
    'points_used', coalesce(v_entitlement.points_used, 0),
    'remaining_orders_this_month', greatest(coalesce(v_entitlement.included_orders_limit, 0) - coalesce(v_entitlement.orders_used, 0), 0),
    'remaining_points_this_month', greatest(coalesce(v_entitlement.included_points_limit, 0) - coalesce(v_entitlement.points_used, 0), 0)
  );
end;
$$;

grant execute on function public.billing_plan_limits(text) to authenticated;
grant execute on function public.billing_upsert_monthly_entitlement(uuid, text, date) to authenticated;
grant execute on function public.get_current_membership_state() to authenticated;
