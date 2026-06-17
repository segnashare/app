-- Backoffice performance: SQL aggregates, nav counts, wallet KPI cache, users page RPC.

-- ---------------------------------------------------------------------------
-- Wallet economy KPI snapshot (single row, refreshed on demand or by triggers)
-- ---------------------------------------------------------------------------
create table if not exists public.backoffice_wallet_economy_kpi_cache (
  id smallint primary key default 1 check (id = 1),
  member_credits_points bigint not null default 0,
  economy_items_points bigint not null default 0,
  segna_stock_items_points bigint not null default 0,
  refreshed_at timestamptz not null default now()
);

create or replace function public.refresh_backoffice_wallet_economy_kpis(
  p_segna_stock_user_id uuid default null
)
returns public.backoffice_wallet_economy_kpi_cache
language plpgsql
security definer
set search_path = public
as $$
declare
  v_segna uuid := coalesce(
    p_segna_stock_user_id,
    'b2c3d4e5-f6a7-4890-b123-456789abcdef'::uuid
  );
  v_member_credits bigint;
  v_economy_items bigint;
  v_segna_stock bigint;
  v_row public.backoffice_wallet_economy_kpi_cache;
begin
  select coalesce(sum(balance_points), 0)::bigint
  into v_member_credits
  from public.user_wallets
  where deleted_at is null
    and user_id is distinct from v_segna;

  select coalesce(sum(price_points), 0)::bigint
  into v_economy_items
  from public.items
  where deleted_at is null
    and status in ('listed', 'available', 'in_cart', 'reserved');

  select coalesce(sum(price_points), 0)::bigint
  into v_segna_stock
  from public.items
  where deleted_at is null
    and owner_user_id = v_segna
    and status in ('listed', 'available', 'in_cart', 'reserved');

  insert into public.backoffice_wallet_economy_kpi_cache as c (
    id,
    member_credits_points,
    economy_items_points,
    segna_stock_items_points,
    refreshed_at
  )
  values (1, v_member_credits, v_economy_items, v_segna_stock, now())
  on conflict (id) do update set
    member_credits_points = excluded.member_credits_points,
    economy_items_points = excluded.economy_items_points,
    segna_stock_items_points = excluded.segna_stock_items_points,
    refreshed_at = excluded.refreshed_at
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.trg_refresh_backoffice_wallet_economy_kpis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_backoffice_wallet_economy_kpis();
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_user_wallets_refresh_bo_wallet_kpis on public.user_wallets;
create trigger trg_user_wallets_refresh_bo_wallet_kpis
after insert or update of balance_points, balance_consumption_points, balance_exchange_points, deleted_at
on public.user_wallets
for each statement
execute function public.trg_refresh_backoffice_wallet_economy_kpis();

drop trigger if exists trg_items_refresh_bo_wallet_kpis on public.items;
create trigger trg_items_refresh_bo_wallet_kpis
after insert or update of price_points, status, deleted_at, owner_user_id
on public.items
for each statement
execute function public.trg_refresh_backoffice_wallet_economy_kpis();

-- ---------------------------------------------------------------------------
-- Moderation pipeline count (replaces JS scan of 2000 item_intake rows)
-- ---------------------------------------------------------------------------
create or replace function public.backoffice_count_moderation_pipeline(
  p_exclude_listing_stages text[] default array['validation_pending']::text[]
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.item_intake ii
  inner join public.items i
    on i.id = ii.item_id
   and i.deleted_at is null
   and i.status = 'draft'
  where ii.listing_stage::text is distinct from 'refused'
    and ii.listing_stage::text is distinct from 'draft'
    and not (ii.listing_stage::text = 'validated' and ii.fulfillment_stage::text = 'verified')
    and (
      p_exclude_listing_stages is null
      or not (ii.listing_stage::text = any (p_exclude_listing_stages))
    );
$$;

-- ---------------------------------------------------------------------------
-- Commandes nav tab counts (lightweight SQL, no full list hydration)
-- ---------------------------------------------------------------------------
create or replace function public.backoffice_commandes_nav_tab_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_paniers_valides bigint;
  v_open_disputes bigint;
  v_retours_urgents bigint;
  v_mise_en_colis bigint;
  v_expeditions_post bigint;
  v_home_ready bigint;
  v_reprise_sim bigint;
  v_reprise_verify bigint;
  v_now timestamptz := now();
  v_day interval := interval '1 day';
begin
  select count(*)::bigint
  into v_paniers_valides
  from public.carts c
  where c.deleted_at is null
    and c.status = 'confirmed'
    and not exists (
      select 1
      from public.shipments s
      where s.cart_id = c.id
        and s.context = 'cart_outbound'
        and s.deleted_at is null
    );

  select count(*)::bigint
  into v_open_disputes
  from public.cart_disputes d
  where d.deleted_at is null
    and d.status in ('open', 'in_review');

  select count(*)::bigint
  into v_retours_urgents
  from (
    select distinct on (s.cart_id)
      s.cart_id,
      coalesce(
        nullif(trim(c.borrow_return_due_at::text), '')::timestamptz,
        coalesce(s.delivered_at, s.updated_at) + interval '14 days'
      ) as due_at
    from public.shipments s
    inner join public.carts c
      on c.id = s.cart_id
     and c.deleted_at is null
     and c.status = 'confirmed'
    where s.deleted_at is null
      and s.context = 'cart_outbound'
      and s.status = 'delivered'
    order by s.cart_id, s.updated_at desc
  ) x
  where x.due_at < v_now + v_day;

  select count(*)::bigint
  into v_mise_en_colis
  from public.shipments s
  where s.deleted_at is null
    and s.context = 'cart_outbound'
    and s.status = 'pending';

  select count(*)::bigint
  into v_expeditions_post
  from public.shipments s
  where s.deleted_at is null
    and s.context = 'cart_outbound'
    and s.status in ('ready', 'dropped_in', 'in_transit_in');

  select count(*)::bigint
  into v_home_ready
  from public.shipments s
  inner join public.cart_order_stripe_invoices inv
    on inv.cart_id = s.cart_id
  where s.deleted_at is null
    and s.context = 'cart_outbound'
    and s.status = 'ready'
    and lower(coalesce(inv.checkout_delivery_channel, '')) = 'home'
    and lower(coalesce(inv.checkout_home_speed, '')) = 'direct';

  select count(*)::bigint
  into v_reprise_sim
  from public.shipments s
  where s.deleted_at is null
    and s.context = 'cart_return'
    and s.status in ('ready', 'dropped_out', 'in_transit_out', 'dropped_in', 'in_transit_in');

  select count(*)::bigint
  into v_reprise_verify
  from public.shipments s
  where s.deleted_at is null
    and s.context = 'cart_return'
    and s.status = 'returned';

  return jsonb_build_object(
    'paniersValides', v_paniers_valides,
    'litigesRetards', v_open_disputes + v_retours_urgents,
    'miseEnColis', v_mise_en_colis,
    'expeditionsPostPreparation', v_mise_en_colis + v_expeditions_post + v_home_ready,
    'repriseControle', v_reprise_sim + v_reprise_verify
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Items hub KPIs (single round-trip)
-- ---------------------------------------------------------------------------
create or replace function public.backoffice_items_hub_kpis(
  p_exclude_validation_stages text[] default array['validation_pending']::text[]
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'totalItems', (select count(*) from public.items where deleted_at is null),
    'listedItems', (select count(*) from public.items where deleted_at is null and status = 'listed'),
    'availableItems', (select count(*) from public.items where deleted_at is null and status = 'available'),
    'disputesOpen', (
      select count(*) from public.item_disputes
      where deleted_at is null and status in ('open', 'in_review')
    ),
    'disputesResolved', (
      select count(*) from public.item_disputes
      where deleted_at is null and status in ('resolved', 'closed')
    ),
    'conditionDrafts', (
      select count(*) from public.item_condition_history where status = 'draft'
    ),
    'pendingValidation', public.backoffice_count_moderation_pipeline(p_exclude_validation_stages),
    'lossesOpen', (select count(*) from public.item_losses where status = 'open'),
    'returnsBadgeCount', (
      select count(*) from public.item_outtake
      where stage::text in (
        'return_open',
        'in_transit',
        'logistics_received',
        'member_verification_pending',
        'member_issue_reported'
      )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Feed preferences aggregates (home_v1, last N days)
-- ---------------------------------------------------------------------------
create or replace function public.backoffice_feed_preferences_overview(
  p_since_days integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, p_since_days));
  v_daily jsonb;
  v_weekly jsonb;
  v_totals jsonb;
begin
  with daily_impressions as (
    select
      to_char((created_at at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as period_start,
      count(*)::bigint as impressions,
      0::bigint as interactions,
      0::bigint as passes,
      0::bigint as likes,
      0::bigint as carts,
      0::bigint as dwell_ms
    from public.member_feed_impressions
    where feed_surface = 'home_v1'
      and created_at >= v_since
    group by 1
  ),
  daily_item_interactions as (
    select
      to_char((created_at at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as period_start,
      0::bigint as impressions,
      count(*)::bigint as interactions,
      count(*) filter (where interaction_type = 'pass')::bigint as passes,
      count(*) filter (where interaction_type = 'like')::bigint as likes,
      count(*) filter (where interaction_type = 'cart_add')::bigint as carts,
      coalesce(sum(dwell_ms), 0)::bigint as dwell_ms
    from public.member_item_interactions
    where source_surface = 'home_v1'
      and created_at >= v_since
    group by 1
  ),
  daily_profile_interactions as (
    select
      to_char((created_at at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as period_start,
      0::bigint as impressions,
      count(*)::bigint as interactions,
      count(*) filter (where interaction_type = 'pass')::bigint as passes,
      count(*) filter (where interaction_type = 'like')::bigint as likes,
      0::bigint as carts,
      coalesce(sum(dwell_ms), 0)::bigint as dwell_ms
    from public.member_profile_interactions
    where source_surface = 'home_v1'
      and created_at >= v_since
    group by 1
  ),
  daily_combined as (
    select period_start,
      sum(impressions) as impressions,
      sum(interactions) as interactions,
      sum(passes) as passes,
      sum(likes) as likes,
      sum(carts) as carts,
      sum(dwell_ms) as dwell_ms
    from (
      select * from daily_impressions
      union all select * from daily_item_interactions
      union all select * from daily_profile_interactions
    ) u
    group by period_start
  ),
  weekly_combined as (
    select
      to_char(
        (date_trunc('week', (period_start::date)::timestamp))::date,
        'YYYY-MM-DD'
      ) as period_start,
      sum(impressions) as impressions,
      sum(interactions) as interactions,
      sum(passes) as passes,
      sum(likes) as likes,
      sum(carts) as carts,
      sum(dwell_ms) as dwell_ms
    from daily_combined
    group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'period_start', period_start,
      'impressions', impressions,
      'interactions', interactions,
      'passes', passes,
      'likes', likes,
      'carts', carts,
      'dwell_ms', dwell_ms
    ) order by period_start
  ), '[]'::jsonb)
  into v_daily
  from daily_combined;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'period_start', period_start,
      'impressions', impressions,
      'interactions', interactions,
      'passes', passes,
      'likes', likes,
      'carts', carts,
      'dwell_ms', dwell_ms
    ) order by period_start
  ), '[]'::jsonb)
  into v_weekly
  from weekly_combined;

  select jsonb_build_object(
    'impressions', coalesce(sum(impressions), 0),
    'interactions', coalesce(sum(interactions), 0),
    'passes', coalesce(sum(passes), 0),
    'likes', coalesce(sum(likes), 0),
    'carts', coalesce(sum(carts), 0),
    'dwell_ms', coalesce(sum(dwell_ms), 0)
  )
  into v_totals
  from daily_combined;

  return jsonb_build_object(
    'daily', v_daily,
    'weekly', v_weekly,
    'totals', v_totals
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Users list page with SQL sort / subscription filter
-- ---------------------------------------------------------------------------
create or replace function public.backoffice_fetch_users_page(
  p_status text default 'active',
  p_q text default '',
  p_subscription text default 'all',
  p_sort text default 'created_desc',
  p_page integer default 1,
  p_per_page integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_offset integer := greatest(0, (greatest(1, p_page) - 1) * greatest(1, p_per_page));
  v_limit integer := greatest(1, least(p_per_page, 100));
  v_total bigint;
  v_rows jsonb;
begin
  with filtered as (
    select
      u.id,
      u.email,
      u.first_name,
      u.last_name,
      u.status,
      u.created_at,
      u.last_login_at,
      u.deleted_at,
      coalesce(x.total_xp, 0) as total_xp,
      coalesce(w.balance_points, 0) as wallet_balance_points,
      sub.plan_code as subscription_plan_code,
      sub.status as subscription_status,
      sub.current_period_end as subscription_period_end
    from public.users u
    left join public.xp_user_state x on x.user_id = u.id
    left join lateral (
      select uw.balance_points
      from public.user_wallets uw
      where uw.user_id = u.id and uw.deleted_at is null
      limit 1
    ) w on true
    left join lateral (
      select us.plan_code, us.status, us.current_period_end
      from public.user_subscriptions us
      where us.user_id = u.id
      order by us.updated_at desc
      limit 1
    ) sub on true
    where (
      (p_status = 'active' and u.deleted_at is null and u.status is distinct from 'banned')
      or (p_status = 'banned' and u.deleted_at is null and u.status = 'banned')
      or (p_status = 'deleted' and u.deleted_at is not null)
      or (p_status = 'all')
    )
    and (
      p_q = '' or p_q is null
      or u.email ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or u.first_name ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or u.last_name ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    and (
      p_subscription = 'all'
      or (
        p_subscription = 'subscribed'
        and sub.plan_code is not null
        and sub.plan_code is distinct from 'guest'
        and sub.status is not null
        and sub.status not in ('inactive', 'canceled')
      )
      or (
        p_subscription = 'unsubscribed'
        and (
          sub.plan_code is null
          or sub.plan_code = 'guest'
          or sub.status is null
          or sub.status in ('inactive', 'canceled')
        )
      )
    )
  ),
  counted as (
    select count(*)::bigint as cnt from filtered
  ),
  paged as (
    select *
    from filtered
    order by
      case when p_sort = 'created_asc' then created_at end asc nulls last,
      case when p_sort = 'created_desc' then created_at end desc nulls last,
      case when p_sort = 'xp_desc' then total_xp end desc nulls last,
      case when p_sort = 'xp_asc' then total_xp end asc nulls last,
      case when p_sort = 'wallet_desc' then wallet_balance_points end desc nulls last,
      case when p_sort = 'wallet_asc' then wallet_balance_points end asc nulls last,
      created_at desc
    offset v_offset
    limit v_limit
  )
  select (select cnt from counted),
    coalesce((select jsonb_agg(to_jsonb(p)) from paged p), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object('totalCount', coalesce(v_total, 0), 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

grant execute on function public.backoffice_count_moderation_pipeline(text[]) to service_role;
grant execute on function public.backoffice_commandes_nav_tab_counts() to service_role;
grant execute on function public.backoffice_items_hub_kpis(text[]) to service_role;
grant execute on function public.backoffice_feed_preferences_overview(integer) to service_role;
grant execute on function public.refresh_backoffice_wallet_economy_kpis(uuid) to service_role;
grant execute on function public.backoffice_fetch_users_page(text, text, text, text, integer, integer) to service_role;

grant select on public.backoffice_wallet_economy_kpi_cache to service_role;

-- Seed wallet KPI cache on migration
select public.refresh_backoffice_wallet_economy_kpis();
