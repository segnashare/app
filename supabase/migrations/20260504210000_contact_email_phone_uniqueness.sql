-- E-mail : pas de changement vers une adresse déjà utilisée par un autre compte (auth.users).
-- Téléphone : un numéro = un compte membre, sauf pour les utilisateurs ayant le rôle app « admin ».

create or replace function public.user_is_staff_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = p_user_id
      and ur.role = 'admin'::public.app_role
  );
$$;

comment on function public.user_is_staff_admin(uuid) is
  'True si le compte a le rôle Segna admin (app_role).';

revoke all on function public.user_is_staff_admin(uuid) from public;
grant execute on function public.user_is_staff_admin(uuid) to authenticated;

-- Appelable côté client uniquement pour auth.uid() (anti-sondage).
create or replace function public.email_available_for_user_change(p_email text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select
    p_user_id is not null
    and p_user_id = auth.uid()
    and coalesce(trim(p_email), '') <> ''
    and not exists (
      select 1
      from auth.users au
      where lower(trim(au.email)) = lower(trim(p_email))
        and coalesce(trim(au.email), '') <> ''
        and au.id is distinct from p_user_id
    );
$$;

comment on function public.email_available_for_user_change(text, uuid) is
  'True si email pas deja pris par un autre compte Auth ; reserve a auth.uid().';

revoke all on function public.email_available_for_user_change(text, uuid) from public;
grant execute on function public.email_available_for_user_change(text, uuid) to authenticated;

create or replace function public.phone_available_for_user_change(p_phone text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and p_user_id = auth.uid()
    and (
      nullif(trim(coalesce(p_phone, '')), '') is null
      or public.user_is_staff_admin(p_user_id)
      or not exists (
        select 1
        from public.users o
        where o.id is distinct from p_user_id
          and nullif(trim(coalesce(o.phone, '')), '') is not null
          and trim(o.phone) = trim(p_phone)
          and not public.user_is_staff_admin(o.id)
      )
    );
$$;

comment on function public.phone_available_for_user_change(text, uuid) is
  'True si numero libre pour membre non-admin ; admins contournent unicite.';

revoke all on function public.phone_available_for_user_change(text, uuid) from public;
grant execute on function public.phone_available_for_user_change(text, uuid) to authenticated;

create or replace function public.enforce_users_phone_unique_except_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p text;
begin
  p := nullif(trim(coalesce(new.phone, '')), '');
  if p is null then
    return new;
  end if;

  if public.user_is_staff_admin(new.id) then
    return new;
  end if;

  if exists (
    select 1
    from public.users o
    where o.id is distinct from new.id
      and nullif(trim(coalesce(o.phone, '')), '') is not null
      and trim(o.phone) = p
      and not public.user_is_staff_admin(o.id)
  ) then
    raise exception using
      errcode = '23505',
      message = 'Ce numéro de téléphone est déjà utilisé par un autre compte.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_users_enforce_phone_unique on public.users;
create trigger trg_users_enforce_phone_unique
before insert or update of phone on public.users
for each row
execute function public.enforce_users_phone_unique_except_admin();

comment on function public.enforce_users_phone_unique_except_admin() is
  'Interdit deux comptes non-admin avec le meme telephone ; comptes admin exclus.';
