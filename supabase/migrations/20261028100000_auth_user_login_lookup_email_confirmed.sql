-- Signup website : rediriger vers signin seulement si l’e-mail a été confirmé (OTP).
-- La RPC renvoyait exists/passwordSet/googleLinked mais pas emailConfirmed.

create or replace function public.auth_user_login_lookup_by_email(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = auth, public
as $$
  with u as (
    select au.id, au.encrypted_password, au.email_confirmed_at
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
        'emailConfirmed', u.email_confirmed_at is not null,
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
  'Pour un e-mail : présence du compte auth, e-mail confirmé, mot de passe défini, identité Google.';

revoke all on function public.auth_user_login_lookup_by_email(text) from public;
grant execute on function public.auth_user_login_lookup_by_email(text) to service_role;
