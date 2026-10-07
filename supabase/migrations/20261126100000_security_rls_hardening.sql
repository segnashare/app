-- Sécurité (audit 2026-09-26) : durcissement RLS ciblé.
--
-- Vérification sur Segna Dev (2026-09-26) : les tables métier (carts, items, shipments, …) ont déjà la RLS
-- active avec des policies propriétaire/staff (créées hors migrations). On ne rajoute donc PAS de policies
-- permissives supplémentaires, qui s'additionneraient aux existantes et élargiraient l'accès.
--
-- Cette migration :
--   1. empêche un membre de s'auto-déclarer KYC vérifié (insert direct dans user_identity_verifications) ;
--   2. expose le seul booléen « KYC validé » d'un autre membre via une RPC (badge fiche article) ;
--   3. active la RLS (deny-all côté client) sur toute table publique qui en serait encore dépourvue.

-- 1. KYC : les lignes sont créées par le serveur (service role, routes /api/kyc/stripe/*) ou le staff.
do $$
begin
  if to_regclass('public.user_identity_verifications') is not null then
    execute 'alter table public.user_identity_verifications enable row level security';
    execute 'drop policy if exists user_identity_verifications_insert_self_staff on public.user_identity_verifications';
    execute 'drop policy if exists user_identity_verifications_insert_staff on public.user_identity_verifications';
    execute $p$
      create policy user_identity_verifications_insert_staff on public.user_identity_verifications
        for insert to authenticated
        with check ((select public.is_staff()))
    $p$;
  end if;
end $$;

-- 2. Statut KYC d'un autre membre sans exposer la table.
create or replace function public.get_member_kyc_verified(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean := false;
begin
  if p_user_id is null or auth.uid() is null then
    return false;
  end if;
  if to_regclass('public.user_identity_verifications') is null then
    return false;
  end if;
  execute $q$
    select exists (
      select 1 from public.user_identity_verifications v
      where v.user_id = $1
        and lower(coalesce(v.verification_status::text, '')) in ('verified', 'approved', 'validated')
    )
  $q$ into v_ok using p_user_id;
  return coalesce(v_ok, false);
end;
$$;
revoke all on function public.get_member_kyc_verified(uuid) from public, anon;
grant execute on function public.get_member_kyc_verified(uuid) to authenticated, service_role;

-- 3. Filet de sécurité : toute table publique sans RLS passe en RLS (aucune policy = aucun accès client).
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise notice 'security: enabling RLS on public.% (no policies, client access denied)', r.relname;
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;
