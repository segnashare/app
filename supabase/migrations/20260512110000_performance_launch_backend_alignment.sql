begin;

alter table public.users
  add column if not exists onboarding_mode text not null default 'real';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_onboarding_mode_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_onboarding_mode_check
      check (onboarding_mode in ('demo', 'bridge', 'real'));
  end if;
end
$$;

drop function if exists public.get_current_membership_state();

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
  v_points_grant bigint;
  v_lends_lim integer;
  v_free_items integer;
  v_wallet_co bigint;
begin
  v_uid := (select auth.uid());
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
    into v_orders_lim, v_points_grant, v_lends_lim, v_free_items
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
    'monthly_consumption_points_grant', coalesce(v_points_grant, 0),
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

grant execute on function public.get_current_membership_state() to authenticated;

create index if not exists carts_user_status_updated_idx
  on public.carts (user_id, status, updated_at desc)
  where deleted_at is null;

create index if not exists cart_items_cart_deleted_created_idx
  on public.cart_items (cart_id, created_at)
  where deleted_at is null;

create index if not exists cart_items_item_deleted_status_cart_idx
  on public.cart_items (item_id, status, cart_id)
  where deleted_at is null;

create index if not exists items_catalog_status_updated_idx
  on public.items (status, updated_at desc)
  where deleted_at is null;

create index if not exists items_owner_status_updated_idx
  on public.items (owner_user_id, status, updated_at desc)
  where deleted_at is null;

create index if not exists item_favorites_user_deleted_created_idx
  on public.item_favorites (user_id, created_at desc)
  where deleted_at is null;

create index if not exists item_favorites_user_item_deleted_idx
  on public.item_favorites (user_id, item_id)
  where deleted_at is null;

create index if not exists shipments_cart_context_updated_idx
  on public.shipments (cart_id, context, updated_at desc)
  where deleted_at is null;

create index if not exists item_condition_history_item_status_recorded_idx
  on public.item_condition_history (item_id, status, recorded_at desc);

create index if not exists wallet_transactions_user_kind_direction_created_idx
  on public.wallet_transactions (user_id, kind, direction, created_at desc);

drop policy if exists wallet_transactions_select_own on public.wallet_transactions;
drop policy if exists wallet_transactions_select_own_or_staff on public.wallet_transactions;
create policy wallet_transactions_select_own_or_staff
  on public.wallet_transactions
  for select
  to authenticated
  using ((user_id = (select auth.uid())) or (select public.is_staff()));

drop policy if exists users_select on public.users;
create policy users_select
  on public.users
  for select
  to authenticated
  using ((id = (select auth.uid())) or (select public.is_staff()));

drop policy if exists users_update on public.users;
create policy users_update
  on public.users
  for update
  to authenticated
  using ((id = (select auth.uid())) or (select public.is_staff()))
  with check ((id = (select auth.uid())) or (select public.is_staff()));

drop policy if exists onboarding_sessions_select_own on public.onboarding_sessions;
create policy onboarding_sessions_select_own
  on public.onboarding_sessions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists onboarding_sessions_update_own on public.onboarding_sessions;
create policy onboarding_sessions_update_own
  on public.onboarding_sessions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists onboarding_sessions_insert_own on public.onboarding_sessions;
create policy onboarding_sessions_insert_own
  on public.onboarding_sessions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists carts_select on public.carts;
create policy carts_select
  on public.carts
  for select
  to authenticated
  using ((user_id = (select auth.uid())) or (select public.is_staff()));

drop policy if exists carts_update on public.carts;
create policy carts_update
  on public.carts
  for update
  to authenticated
  using ((user_id = (select auth.uid())) or (select public.is_staff()))
  with check ((user_id = (select auth.uid())) or (select public.is_staff()));

drop policy if exists carts_insert on public.carts;
create policy carts_insert
  on public.carts
  for insert
  to authenticated
  with check ((user_id = (select auth.uid())) or (select public.is_staff()));

drop policy if exists item_favorites_select on public.item_favorites;
create policy item_favorites_select
  on public.item_favorites
  for select
  to authenticated
  using ((user_id = (select auth.uid())) or (select public.is_staff()));

drop policy if exists item_favorites_insert on public.item_favorites;
create policy item_favorites_insert
  on public.item_favorites
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists item_favorites_delete on public.item_favorites;
create policy item_favorites_delete
  on public.item_favorites
  for delete
  to authenticated
  using ((user_id = (select auth.uid())) or (select public.is_staff()));

commit;
