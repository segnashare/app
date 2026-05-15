-- Connexion e-mail / mot de passe : distinguer compte Google-only (pas de encrypted_password)
-- des comptes avec mot de passe, pour afficher un message utile au lieu de « mot de passe incorrect ».

create or replace function public.auth_user_login_lookup_by_email(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = auth, public
as $$
  with u as (
    select au.id, au.encrypted_password
    from auth.users au
    where lower(btrim(au.email)) = lower(btrim(p_email))
      and coalesce(btrim(au.email), '') <> ''
    limit 1
  )
  select case
    when not exists (select 1 from u) then '{"exists":false}'::jsonb
    else (
      select jsonb_build_object(
        'exists', true,
        'passwordSet', coalesce(length(u.encrypted_password), 0) > 0,
        'googleLinked', exists (
          select 1
          from auth.identities i
          where i.user_id = u.id
            and i.provider = 'google'
        )
      )
      from u
    )
  end;
$$;

comment on function public.auth_user_login_lookup_by_email(text) is
  'Pour un e-mail : présence du compte auth, mot de passe défini, identité Google (connexion sans mot de passe Segna).';

revoke all on function public.auth_user_login_lookup_by_email(text) from public;
grant execute on function public.auth_user_login_lookup_by_email(text) to service_role;
