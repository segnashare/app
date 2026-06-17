-- PostgREST ne voit pas toujours les nouvelles RPC tant que le cache schéma n'est pas rechargé.
-- Recrée la signature attendue + grants explicites + NOTIFY.

create or replace function public.backoffice_fetch_users_page(
  p_page integer default 1,
  p_per_page integer default 25,
  p_q text default '',
  p_sort text default 'created_desc',
  p_status text default 'active',
  p_subscription text default 'all'
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

-- Drop old signature if present (parameter order differs).
drop function if exists public.backoffice_fetch_users_page(text, text, text, text, integer, integer);

grant execute on function public.backoffice_fetch_users_page(integer, integer, text, text, text, text) to service_role;
grant execute on function public.backoffice_fetch_users_page(integer, integer, text, text, text, text) to authenticated;

grant execute on function public.backoffice_count_moderation_pipeline(text[]) to service_role;
grant execute on function public.backoffice_commandes_nav_tab_counts() to service_role;
grant execute on function public.backoffice_items_hub_kpis(text[]) to service_role;
grant execute on function public.backoffice_feed_preferences_overview(integer) to service_role;
grant execute on function public.refresh_backoffice_wallet_economy_kpis(uuid) to service_role;

notify pgrst, 'reload schema';
