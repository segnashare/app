-- Numéros autorisés sur plusieurs comptes membres (hors rôle admin).
-- Aligner les lignes de cette table avec NEXT_PUBLIC_SEGNA_MULTI_ACCOUNT_PHONE_E164 côté app.

create table if not exists public.phone_multi_account_exceptions (
  phone_e164 text primary key,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.phone_multi_account_exceptions is
  'Téléphones E.164 pouvant être liés à plusieurs comptes non-admin ; contourne unicite users.phone.';

alter table public.phone_multi_account_exceptions enable row level security;

revoke all on table public.phone_multi_account_exceptions from anon, authenticated;

create or replace function public.phone_is_multi_account_exception(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.phone_multi_account_exceptions e
    where trim(e.phone_e164) = trim(coalesce(p_phone, ''))
      and nullif(trim(coalesce(p_phone, '')), '') is not null
  );
$$;

comment on function public.phone_is_multi_account_exception(text) is
  'True si le numero est dans phone_multi_account_exceptions (plusieurs comptes autorises).';

revoke all on function public.phone_is_multi_account_exception(text) from public;
grant execute on function public.phone_is_multi_account_exception(text) to authenticated;

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
      or public.phone_is_multi_account_exception(p_phone)
      or not exists (
        select 1
        from public.users o
        where o.id is distinct from p_user_id
          and nullif(trim(coalesce(o.phone, '')), '') is not null
          and trim(o.phone) = trim(p_phone)
          and not public.user_is_staff_admin(o.id)
          and not public.phone_is_multi_account_exception(trim(o.phone))
      )
    );
$$;

comment on function public.phone_available_for_user_change(text, uuid) is
  'True si numero libre pour membre non-admin ; admins et exceptions multi-comptes contournent unicite.';

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

  if public.phone_is_multi_account_exception(p) then
    return new;
  end if;

  if exists (
    select 1
    from public.users o
    where o.id is distinct from new.id
      and nullif(trim(coalesce(o.phone, '')), '') is not null
      and trim(o.phone) = p
      and not public.user_is_staff_admin(o.id)
      and not public.phone_is_multi_account_exception(trim(o.phone))
  ) then
    raise exception using
      errcode = '23505',
      message = 'Ce numéro de téléphone est déjà utilisé par un autre compte.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_users_phone_unique_except_admin() is
  'Interdit deux comptes non-admin avec le meme telephone ; admins et exceptions multi-comptes exclus.';

-- Exemple (ajuster / dupliquer selon besoin) :
-- insert into public.phone_multi_account_exceptions (phone_e164, note)
-- values ('+33781774735', 'Fondateur — plusieurs comptes de test')
-- on conflict (phone_e164) do nothing;
