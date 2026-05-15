-- Supprime super_admin (données migrées vers admin) en recréant l’enum app_role.
-- Nécessite de retirer temporairement les policies et has_role() qui dépendent du type.
-- `referrals` / `referrals_codes` peuvent ne pas exister encore (introduits plus tard) : pas de DROP/CREATE sur relation absente.

do $$
begin
  if to_regclass('public.referrals_codes') is not null then
    execute 'drop policy if exists referrals_codes_select_own_or_mod on public.referrals_codes';
  end if;
  if to_regclass('public.referrals') is not null then
    execute 'drop policy if exists referrals_select_own_or_mod on public.referrals';
    execute 'drop policy if exists referrals_admin_all on public.referrals';
  end if;
  if to_regclass('public.item_condition_history') is not null then
    execute 'drop policy if exists item_condition_history_select_via_staff on public.item_condition_history';
    execute 'drop policy if exists item_condition_history_insert_via_staff on public.item_condition_history';
  end if;
end;
$$;

-- has_role(...) peut référencer un type absent sur base neuve (100950 : role en text, pas d’enum app_role).
do $$
declare
  r record;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'has_role'
      and p.prokind = 'f'
  loop
    execute format('drop function if exists public.has_role(%s)', r.args);
  end loop;
end;
$$;

-- Ancienne prod : enum app_role avec super_admin → rename + recréation.
-- Base neuve (migrations récentes) : pas d’enum → création directe + cast depuis text.
do $$
declare
  v_has_app_role boolean;
  v_actor_col boolean;
begin
  select exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and t.typtype = 'e'
  )
  into v_has_app_role;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'activity_events'
      and c.column_name = 'actor_role'
  )
  into v_actor_col;

  if v_has_app_role then
    execute 'alter type public.app_role rename to app_role_old';
    execute 'create type public.app_role as enum (''user'', ''moderator'', ''admin'')';
    execute 'alter table public.user_roles alter column role drop default';
    execute $sql$
      alter table public.user_roles
        alter column role type public.app_role using (
          case role::text
            when 'user' then 'user'::public.app_role
            when 'moderator' then 'moderator'::public.app_role
            when 'admin' then 'admin'::public.app_role
            when 'super_admin' then 'admin'::public.app_role
            else 'user'::public.app_role
          end
        )
    $sql$;
    execute 'alter table public.user_roles alter column role set default ''user''::public.app_role';
    if v_actor_col then
      execute $sql$
        alter table public.activity_events
          alter column actor_role type public.app_role using (
            case
              when actor_role is null then null::public.app_role
              when actor_role::text = 'user' then 'user'::public.app_role
              when actor_role::text = 'moderator' then 'moderator'::public.app_role
              when actor_role::text = 'admin' then 'admin'::public.app_role
              when actor_role::text = 'super_admin' then 'admin'::public.app_role
              else 'user'::public.app_role
            end
          )
      $sql$;
    end if;
    execute 'drop type public.app_role_old';
  else
    execute 'create type public.app_role as enum (''user'', ''moderator'', ''admin'')';
    execute 'alter table public.user_roles alter column role drop default';
    execute $sql$
      alter table public.user_roles
        alter column role type public.app_role using (
          case lower(trim(coalesce(role::text, '')))
            when 'user' then 'user'::public.app_role
            when 'moderator' then 'moderator'::public.app_role
            when 'admin' then 'admin'::public.app_role
            when 'super_admin' then 'admin'::public.app_role
            else 'user'::public.app_role
          end
        )
    $sql$;
    execute 'alter table public.user_roles alter column role set default ''user''::public.app_role';
    if v_actor_col then
      execute $sql$
        alter table public.activity_events
          alter column actor_role type public.app_role using (
            case
              when actor_role is null then null::public.app_role
              when trim(coalesce(actor_role::text, '')) = '' then null::public.app_role
              when lower(trim(actor_role::text)) = 'user' then 'user'::public.app_role
              when lower(trim(actor_role::text)) = 'moderator' then 'moderator'::public.app_role
              when lower(trim(actor_role::text)) = 'admin' then 'admin'::public.app_role
              when lower(trim(actor_role::text)) = 'super_admin' then 'admin'::public.app_role
              else 'user'::public.app_role
            end
          )
      $sql$;
    end if;
  end if;
end;
$$;

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

do $$
begin
  if to_regclass('public.referrals_codes') is not null then
    execute $pol$
      create policy referrals_codes_select_own_or_mod on public.referrals_codes for select to authenticated
        using (
          (user_id = auth.uid())
          or exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and lower(ur.role::text) = any (array['moderator'::text, 'admin'::text])
          )
        );
    $pol$;
  end if;
  if to_regclass('public.referrals') is not null then
    execute $pol$
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
    $pol$;
    execute $pol$
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
    $pol$;
  end if;
end;
$$;

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
