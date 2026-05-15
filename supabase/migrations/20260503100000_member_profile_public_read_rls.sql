-- Lecture profil membre par d’autres membres connectés (boutique, /membre/[id], etc.).

drop policy if exists "user_profiles_select_visible_members" on public.user_profiles;
create policy "user_profiles_select_visible_members"
on public.user_profiles
for select
to authenticated
using (
  user_id is distinct from auth.uid()
  and exists (
    select 1
    from public.users u
    where u.id = user_profiles.user_id
      and u.deleted_at is null
      and u.status is distinct from 'corporate_inventory'::public.user_status
  )
);

drop policy if exists "user_profile_brands_select_visible_member_profiles" on public.user_profile_brands;
create policy "user_profile_brands_select_visible_member_profiles"
on public.user_profile_brands
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    inner join public.users u on u.id = up.user_id
    where up.id = user_profile_brands.user_profile_id
      and u.deleted_at is null
      and u.status is distinct from 'corporate_inventory'::public.user_status
      and up.user_id is distinct from auth.uid()
  )
);

drop policy if exists "xp_user_state_select_visible_members" on public.xp_user_state;
create policy "xp_user_state_select_visible_members"
on public.xp_user_state
for select
to authenticated
using (
  user_id is distinct from auth.uid()
  and exists (
    select 1
    from public.users u
    where u.id = xp_user_state.user_id
      and u.deleted_at is null
      and u.status is distinct from 'corporate_inventory'::public.user_status
  )
);

comment on policy "user_profiles_select_visible_members" on public.user_profiles is
  'Permet aux membres connectés de lire les profils des autres membres actifs (hors corporate).';
