-- Segna "membre" = ligne public.users (créée au bootstrap après mot de passe).
-- auth.users peut exister dès l'OTP : ne pas le confondre avec un membre final.

create or replace function public.member_exists_by_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and coalesce(btrim(u.email), '') <> ''
  );
$$;

comment on function public.member_exists_by_email(text) is
  'True si un membre Segna (public.users) existe pour cet e-mail — post-mot de passe / bootstrap.';

revoke all on function public.member_exists_by_email(text) from public;
grant execute on function public.member_exists_by_email(text) to service_role;

-- Pour connexion / mot de passe oublié : présence d''un compte Auth (peut être sans public.users).

create or replace function public.auth_user_exists_by_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select exists (
    select 1
    from auth.users u
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and coalesce(btrim(u.email), '') <> ''
  );
$$;

comment on function public.auth_user_exists_by_email(text) is
  'True si auth.users contient cet e-mail (OTP, OAuth, etc.).';

revoke all on function public.auth_user_exists_by_email(text) from public;
grant execute on function public.auth_user_exists_by_email(text) to service_role;
