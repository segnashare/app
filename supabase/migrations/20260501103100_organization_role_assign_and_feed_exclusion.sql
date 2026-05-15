-- Après commit de l’ajout d’enum `organization` (migration précédente).

-- Assign organization role to Segna technical organization users.
insert into public.user_roles (user_id, role)
select u.id, 'organization'::public.app_role
from public.users u
where u.status = 'corporate_inventory'::public.user_status
  and u.deleted_at is null
on conflict (user_id, role) do update
set
  deleted_at = null,
  updated_at = now();

create or replace function public.is_profile_eligible_for_home_feed(
  p_member_user_id uuid,
  p_profile_user_id uuid,
  p_min_days_since_last_seen integer default 30
)
returns boolean
language sql
stable
set search_path = public
as $$
  with h as (
    select
      x.last_seen_at,
      x.last_entity_updated_at_at_seen
    from public.member_feed_entity_history x
    where x.member_user_id = p_member_user_id
      and x.entity_type = 'profile'::public.feed_entity_type
      and x.profile_user_id = p_profile_user_id
    limit 1
  ),
  p as (
    select up.updated_at
    from public.user_profiles up
    where up.user_id = p_profile_user_id
    limit 1
  )
  select
    case
      when p_member_user_id is null
        or p_profile_user_id is null
        or p_member_user_id = p_profile_user_id
      then false
      when exists (
        select 1
        from public.users u
        where u.id = p_profile_user_id
          and u.status = 'corporate_inventory'::public.user_status
      )
      then false
      when exists (
        select 1
        from public.user_roles ur
        where ur.user_id = p_profile_user_id
          and ur.role = 'organization'::public.app_role
          and ur.deleted_at is null
      )
      then false
      when not exists (select 1 from p)
      then false
      when not exists (select 1 from h)
      then true
      when now() < ((select h.last_seen_at from h) + make_interval(days => greatest(1, p_min_days_since_last_seen)))
      then false
      when (select p.updated_at from p) <= coalesce(
        (select h.last_entity_updated_at_at_seen from h),
        (select h.last_seen_at from h)
      )
      then false
      else true
    end;
$$;
