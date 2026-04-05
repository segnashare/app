-- Profils « membre » créés par le staff sans compte auth : rattachement à la première
-- inscription avec le même email (normalisé). Pièces stock Segna : colonne intended_prospect_id.

create table if not exists public.member_prospects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text not null,
  first_name text,
  last_name text,
  phone text,
  staff_notes text,
  created_by_user_id uuid references public.users (id) on delete set null,
  claimed_at timestamptz,
  claimed_user_id uuid references public.users (id) on delete set null,
  constraint member_prospects_claimed_consistency check (
    (claimed_user_id is null and claimed_at is null)
    or (claimed_user_id is not null and claimed_at is not null)
  )
);

create unique index if not exists member_prospects_email_lower_trim_uq
  on public.member_prospects ((lower(trim(email))));

comment on table public.member_prospects is
  'Fiche prospect sans auth.users ; claimed_* rempli quand un membre s''inscrit avec le même email.';

drop trigger if exists trg_member_prospects_updated_at on public.member_prospects;
create trigger trg_member_prospects_updated_at
before update on public.member_prospects
for each row execute function public.set_updated_at();

alter table public.items
  add column if not exists intended_prospect_id uuid references public.member_prospects (id) on delete set null;

comment on column public.items.intended_prospect_id is
  'Si renseigné, la pièce est prévue pour ce prospect (ex. owner = stock Segna) ; transfert vers claimed_user à l''inscription.';

create index if not exists items_intended_prospect_id_idx
  on public.items (intended_prospect_id)
  where intended_prospect_id is not null;

alter table public.member_prospects enable row level security;

-- Pas de policy : lecture/écriture service_role uniquement (backoffice).

grant select, insert, update, delete on public.member_prospects to service_role;

-- ---------------------------------------------------------------------------
-- Rattachement à l’inscription (appelé depuis bootstrap_user_after_signup)
-- ---------------------------------------------------------------------------

create or replace function public.claim_member_prospect_for_new_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_prospect_id uuid;
  v_fn text;
  v_ln text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return;
  end if;

  select a.email
  into v_email
  from auth.users a
  where a.id = v_uid;

  if v_email is null or length(trim(v_email)) = 0 then
    return;
  end if;

  select mp.id, mp.first_name, mp.last_name
  into v_prospect_id, v_fn, v_ln
  from public.member_prospects mp
  where lower(trim(mp.email)) = lower(trim(v_email))
    and mp.claimed_user_id is null
  limit 1;

  if v_prospect_id is null then
    return;
  end if;

  update public.member_prospects
  set
    claimed_user_id = v_uid,
    claimed_at = now(),
    updated_at = now()
  where id = v_prospect_id;

  update public.users u
  set
    first_name = case
      when nullif(trim(u.first_name), '') is null then nullif(trim(v_fn), '')
      else u.first_name
    end,
    last_name = case
      when nullif(trim(u.last_name), '') is null then nullif(trim(v_ln), '')
      else u.last_name
    end
  where u.id = v_uid;

  update public.items
  set
    owner_user_id = v_uid,
    intended_prospect_id = null
  where intended_prospect_id = v_prospect_id;

  perform public.log_activity_event(
    'member_prospect_claimed',
    jsonb_build_object(
      'prospect_id', v_prospect_id,
      'user_id', v_uid,
      'email', v_email
    ),
    null
  );
end;
$$;

revoke all on function public.claim_member_prospect_for_new_user() from public;
grant execute on function public.claim_member_prospect_for_new_user() to authenticated;

-- Injecte l’appel dans bootstrap (copie alignée sur 20260311101500).

create or replace function public.bootstrap_user_after_signup(
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default null,
  p_timezone text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_phone text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email, phone
  into v_email, v_phone
  from auth.users
  where id = v_uid;

  insert into public.users (id, email, phone, first_name, last_name, locale, timezone)
  values (v_uid, v_email, v_phone, p_first_name, p_last_name, p_locale, p_timezone)
  on conflict (id) do update
  set email = excluded.email,
      phone = excluded.phone,
      first_name = coalesce(excluded.first_name, public.users.first_name),
      last_name = coalesce(excluded.last_name, public.users.last_name),
      locale = coalesce(excluded.locale, public.users.locale),
      timezone = coalesce(excluded.timezone, public.users.timezone);

  insert into public.user_roles (user_id, role)
  values (v_uid, 'user')
  on conflict (user_id, role) do nothing;

  insert into public.user_wallets (user_id, balance)
  values (v_uid, 0)
  on conflict (user_id) do nothing;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  insert into public.onboarding_sessions (user_id, status, current_step, progress)
  values (v_uid, 'in_progress', '/onboarding/welcome', jsonb_build_object('checkpoint', '/onboarding/welcome'))
  on conflict (user_id) do nothing;

  perform public.claim_member_prospect_for_new_user();

  perform public.log_activity_event(
    p_event_name => 'bootstrap_user_after_signup',
    p_payload => jsonb_build_object(
      'first_name', p_first_name,
      'last_name', p_last_name,
      'locale', p_locale,
      'timezone', p_timezone
    ),
    p_request_id => p_request_id
  );

  return public.get_me_context();
end;
$$;

grant execute on function public.bootstrap_user_after_signup(text, text, text, text, uuid) to authenticated;
