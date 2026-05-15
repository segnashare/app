-- Compte technique "stock Segna" : rattache les items corporate à un seul user dédié.
-- Contrainte Supabase : public.users.id référence auth.users.id → une ligne auth minimale
-- est créée, mais PAS d'entrée dans auth.identities (pas de flux de connexion classique).

create extension if not exists "pgcrypto";

-- Bases neuves (100950) : `users.status` est du texte, pas d’enum `user_status` (héritage prod).
do $$
declare
  r record;
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'user_status'
  ) then
    create type public.user_status as enum (
      'pending_onboarding',
      'active',
      'suspended',
      'pending',
      'banned',
      'corporate_inventory'
    );
    -- Ancien schéma 100950 : CHECK texte sur `status` ; incompatible avec le passage en enum.
    for r in
      select con.conname
      from pg_constraint con
      where con.conrelid = 'public.users'::regclass
        and con.contype = 'c'
        and con.conkey is not null
        and exists (
          select 1
          from unnest(con.conkey) as rel_att(attnum)
          join pg_attribute a
            on a.attrelid = con.conrelid
           and a.attnum = rel_att.attnum
           and a.attname = 'status'
        )
    loop
      execute format('alter table public.users drop constraint %I', r.conname);
    end loop;
    alter table public.users alter column status drop default;
    alter table public.users
      alter column status type public.user_status using (
        case coalesce(trim(status::text), '')
          when 'pending_onboarding' then 'pending_onboarding'::public.user_status
          when 'active' then 'active'::public.user_status
          when 'suspended' then 'suspended'::public.user_status
          when 'pending' then 'pending'::public.user_status
          when 'banned' then 'banned'::public.user_status
          when 'corporate_inventory' then 'corporate_inventory'::public.user_status
          else 'pending_onboarding'::public.user_status
        end
      );
    alter table public.users
      alter column status set default 'pending_onboarding'::public.user_status;
    alter table public.users
      alter column status set not null;
  else
    begin
      alter type public.user_status add value if not exists 'corporate_inventory';
    exception
      when duplicate_object then null;
    end;
  end if;
end
$$;

-- Doit rester aligné avec segna-backoffice/src/lib/config/segna-corporate-inventory.ts
-- (sauf surcharge SEGNA_CORPORATE_INVENTORY_USER_ID côté déploiement).
do $$
declare
  v_id constant uuid := 'b2c3d4e5-f6a7-4890-b123-456789abcdef'::uuid;
  v_instance uuid;
begin
  begin
    select i.id
    into strict v_instance
    from auth.instances i
    limit 1;
  exception
    when no_data_found then
      v_instance := '00000000-0000-0000-0000-000000000000'::uuid;
    when undefined_table then
      v_instance := '00000000-0000-0000-0000-000000000000'::uuid;
  end;

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    v_id,
    v_instance,
    'authenticated',
    'authenticated',
    'corporate.inventory@system.segna',
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    updated_at = now();

  -- Pas de insert dans auth.identities : ce compte ne doit pas permettre de se connecter
  -- via le provider email standard.

  -- Évite les triggers public.users → user_profiles (certaines bases matérialisent mal les DEFAULT
  -- sur INSERT partiel / ON CONFLICT et lèvent 23502 sur profile_data).
  alter table public.users disable trigger user;

  begin
    insert into public.users (
      id,
      email,
      first_name,
      last_name,
      status
    )
    values (
      v_id,
      'corporate.inventory@system.segna',
      'Segna',
      'Stock',
      'corporate_inventory'::public.user_status
    )
    on conflict (id) do update
    set
      email = excluded.email,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      status = excluded.status,
      updated_at = now();

    insert into public.user_profiles (
      user_id,
      display_name,
      photos,
      profile_data,
      preferences,
      looks,
      answers
    )
    values (
      v_id,
      'Segna S.',
      '[]'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
    on conflict (user_id) do update
    set
      display_name = excluded.display_name,
      photos = coalesce(public.user_profiles.photos, excluded.photos),
      profile_data = coalesce(public.user_profiles.profile_data, excluded.profile_data),
      preferences = coalesce(public.user_profiles.preferences, excluded.preferences),
      looks = coalesce(public.user_profiles.looks, excluded.looks),
      answers = coalesce(public.user_profiles.answers, excluded.answers);

    if to_regclass('public.xp_user_state') is not null then
      insert into public.xp_user_state (user_id)
      values (v_id)
      on conflict (user_id) do nothing;
    end if;

    if to_regclass('public.xp_streak') is not null then
      insert into public.xp_streak (user_id)
      values (v_id)
      on conflict (user_id) do nothing;
    end if;
  exception
    when others then
      alter table public.users enable trigger user;
      raise;
  end;

  alter table public.users enable trigger user;
end;
$$;

-- Rôle applicatif : voir 20260329120000_app_role_segna_system.sql (user_roles.role = segna_system).
