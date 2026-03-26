-- Supprime super_admin (données migrées vers admin) en recréant l’enum app_role.
-- Nécessite de retirer temporairement les policies et has_role() qui dépendent du type.

drop policy if exists referrals_codes_select_own_or_mod on public.referrals_codes;
drop policy if exists referrals_select_own_or_mod on public.referrals;
drop policy if exists referrals_admin_all on public.referrals;
drop policy if exists item_condition_history_select_via_staff on public.item_condition_history;
drop policy if exists item_condition_history_insert_via_staff on public.item_condition_history;

drop function if exists public.has_role(public.app_role);

alter type public.app_role rename to app_role_old;

create type public.app_role as enum ('user', 'moderator', 'admin');

alter table public.user_roles
  alter column role type public.app_role using (
    case role::text
      when 'user' then 'user'::public.app_role
      when 'moderator' then 'moderator'::public.app_role
      when 'admin' then 'admin'::public.app_role
      when 'super_admin' then 'admin'::public.app_role
      else 'user'::public.app_role
    end
  );

alter table public.activity_events
  alter column actor_role type public.app_role using (
    case
      when actor_role is null then null
      when actor_role::text = 'user' then 'user'::public.app_role
      when actor_role::text = 'moderator' then 'moderator'::public.app_role
      when actor_role::text = 'admin' then 'admin'::public.app_role
      when actor_role::text = 'super_admin' then 'admin'::public.app_role
      else 'user'::public.app_role
    end
  );

drop type public.app_role_old;

create or replace function public.has_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path to public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = _role
      and ur.deleted_at is null
  );
$$;

grant execute on function public.has_role(public.app_role) to authenticated;

create policy referrals_codes_select_own_or_mod on public.referrals_codes for select to authenticated
  using (
    (user_id = auth.uid())
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and lower(ur.role::text) = any (array['moderator'::text, 'admin'::text])
    )
  );

create policy referrals_select_own_or_mod on public.referrals for select to authenticated
  using (
    (referrer_user_id = auth.uid())
    or (referred_user_id = auth.uid())
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and lower(ur.role::text) = any (array['moderator'::text, 'admin'::text])
    )
  );

create policy referrals_admin_all on public.referrals for all to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and lower(ur.role::text) = 'admin'::text
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and lower(ur.role::text) = 'admin'::text
    )
  );

do $$
begin
  if to_regclass('public.item_condition_history') is not null then
    execute 'drop policy if exists item_condition_history_select_via_staff on public.item_condition_history';
    execute 'drop policy if exists item_condition_history_insert_via_staff on public.item_condition_history';
    execute $pol$
      create policy item_condition_history_select_via_staff
        on public.item_condition_history for select
        to authenticated
        using (
          exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and ur.role in ('moderator'::public.app_role, 'admin'::public.app_role)
              and ur.deleted_at is null
          )
        );
    $pol$;
    execute $pol$
      create policy item_condition_history_insert_via_staff
        on public.item_condition_history for insert
        to authenticated
        with check (
          exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and ur.role in ('moderator'::public.app_role, 'admin'::public.app_role)
              and ur.deleted_at is null
          )
        );
    $pol$;
  end if;
end;
$$;
