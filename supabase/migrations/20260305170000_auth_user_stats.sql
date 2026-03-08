-- Auth user counters for admin analytics.
create or replace function public.auth_user_stats()
returns table (
  total_users bigint,
  confirmed_users bigint,
  unconfirmed_users bigint,
  onboarding_completed_users bigint
)
language sql
security definer
set search_path = public, auth
as $$
  select
    count(*)::bigint as total_users,
    count(*) filter (where u.email_confirmed_at is not null)::bigint as confirmed_users,
    count(*) filter (where u.email_confirmed_at is null)::bigint as unconfirmed_users,
    count(*) filter (where p.onboarding_completed_at is not null)::bigint as onboarding_completed_users
  from auth.users u
  left join public.profiles p on p.id = u.id;
$$;

create or replace view public.auth_user_stats_view as
select *
from public.auth_user_stats();

revoke all on function public.auth_user_stats() from public;
revoke all on function public.auth_user_stats() from anon;
revoke all on function public.auth_user_stats() from authenticated;
grant execute on function public.auth_user_stats() to service_role;

revoke all on public.auth_user_stats_view from public;
revoke all on public.auth_user_stats_view from anon;
revoke all on public.auth_user_stats_view from authenticated;
grant select on public.auth_user_stats_view to service_role;
