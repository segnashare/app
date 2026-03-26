-- Compte technique "stock Segna" : rattache les items corporate à un seul user dédié.
-- Contrainte Supabase : public.users.id référence auth.users.id → une ligne auth minimale
-- est créée, mais PAS d'entrée dans auth.identities (pas de flux de connexion classique).

create extension if not exists "pgcrypto";

do $$
begin
  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'user_status'
  ) then
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
    crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
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
end
$$;

-- Rôle applicatif : voir 20260329120000_app_role_segna_system.sql (user_roles.role = segna_system).
