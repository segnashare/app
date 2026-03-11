-- Core auth/onboarding entities + RPCs (idempotent bridge migration)
-- This migration introduces the new "users/user_profiles/user_preferences" model
-- while keeping backward-compatible RPC wrappers used by the current frontend.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text,
  phone text,
  first_name text,
  last_name text,
  locale text,
  timezone text,
  status text not null default 'pending_onboarding'
    check (status in ('pending_onboarding', 'active', 'suspended')),
  onboarding_completed_at timestamptz
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'user',
  unique (user_id, role)
);

create table if not exists public.user_wallets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  balance numeric(12, 2) not null default 0
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  bio text,
  avatar_url text,
  photos jsonb not null default '[]'::jsonb,
  profile_data jsonb not null default '{}'::jsonb
);

create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  locale text,
  timezone text,
  onboarding_answers jsonb not null default '{}'::jsonb,
  visibility jsonb not null default '{}'::jsonb,
  marketing_opt_in boolean not null default false,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null,
  version text not null,
  granted boolean not null,
  granted_at timestamptz not null default now(),
  request_id uuid,
  unique (user_id, consent_type, version)
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  request_id uuid
);

-- Ensure onboarding_sessions supports "in_progress" as canonical in-flight status.
alter table public.onboarding_sessions
  alter column status set default 'in_progress';

update public.onboarding_sessions
set status = 'in_progress'
where status = 'draft';

alter table public.onboarding_sessions
  drop constraint if exists onboarding_sessions_status_check;

alter table public.onboarding_sessions
  add constraint onboarding_sessions_status_check
  check (status in ('in_progress', 'completed', 'abandoned', 'draft'));

-- keep profiles table in sync if it exists and is still used by old code paths.
insert into public.users (id, email, phone)
select id, email, phone
from auth.users
on conflict (id) do update
set email = excluded.email,
    phone = excluded.phone;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_roles_updated_at on public.user_roles;
create trigger trg_user_roles_updated_at
before update on public.user_roles
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_wallets_updated_at on public.user_wallets;
create trigger trg_user_wallets_updated_at
before update on public.user_wallets
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_preferences_updated_at on public.user_preferences;
create trigger trg_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_consents_updated_at on public.user_consents;
create trigger trg_user_consents_updated_at
before update on public.user_consents
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_wallets enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_consents enable row level security;
alter table public.activity_events enable row level security;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users
for select to authenticated
using (id = auth.uid());

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own" on public.users
for insert to authenticated
with check (id = auth.uid());

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "user_roles_select_own" on public.user_roles;
create policy "user_roles_select_own" on public.user_roles
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "user_wallets_select_own" on public.user_wallets;
create policy "user_wallets_select_own" on public.user_wallets
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own" on public.user_profiles
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own" on public.user_profiles
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own" on public.user_profiles
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own" on public.user_preferences
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own" on public.user_preferences
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own" on public.user_preferences
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "user_consents_select_own" on public.user_consents;
create policy "user_consents_select_own" on public.user_consents
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "user_consents_insert_own" on public.user_consents;
create policy "user_consents_insert_own" on public.user_consents
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "activity_events_select_own" on public.activity_events;
create policy "activity_events_select_own" on public.activity_events
for select to authenticated
using (user_id = auth.uid());

grant select, insert, update on public.users to authenticated;
grant select on public.user_roles to authenticated;
grant select on public.user_wallets to authenticated;
grant select, insert, update on public.user_profiles to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select, insert on public.user_consents to authenticated;
grant select on public.activity_events to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.log_activity_event(
  p_event_name text,
  p_payload jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  insert into public.activity_events (user_id, event_name, payload, request_id)
  values (v_uid, p_event_name, coalesce(p_payload, '{}'::jsonb), p_request_id);
end;
$$;

create or replace function public.get_me_context()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_users jsonb;
  v_roles jsonb;
  v_wallet jsonb;
  v_profile jsonb;
  v_preferences jsonb;
  v_onboarding jsonb;
  v_missing text[] := '{}';
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select to_jsonb(u) into v_users from public.users u where u.id = v_uid;
  if v_users is null then v_missing := array_append(v_missing, 'users'); end if;

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_roles
  from public.user_roles r where r.user_id = v_uid;
  if v_roles = '[]'::jsonb then v_missing := array_append(v_missing, 'user_roles'); end if;

  select to_jsonb(w) into v_wallet from public.user_wallets w where w.user_id = v_uid;
  if v_wallet is null then v_missing := array_append(v_missing, 'user_wallets'); end if;

  select to_jsonb(p) into v_profile from public.user_profiles p where p.user_id = v_uid;
  if v_profile is null then v_missing := array_append(v_missing, 'user_profiles'); end if;

  select to_jsonb(pr) into v_preferences from public.user_preferences pr where pr.user_id = v_uid;
  if v_preferences is null then v_missing := array_append(v_missing, 'user_preferences'); end if;

  select to_jsonb(s) into v_onboarding from public.onboarding_sessions s where s.user_id = v_uid;
  if v_onboarding is null then v_missing := array_append(v_missing, 'onboarding_sessions'); end if;

  return jsonb_build_object(
    'users', v_users,
    'roles', coalesce(v_roles, '[]'::jsonb),
    'wallet', v_wallet,
    'profile', v_profile,
    'preferences', v_preferences,
    'onboarding_sessions', v_onboarding,
    'missing_entities', to_jsonb(v_missing)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Core RPCs
-- ---------------------------------------------------------------------------

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

  insert into public.users (id, email, phone, first_name, last_name, locale, timezone, status)
  values (v_uid, v_email, v_phone, p_first_name, p_last_name, p_locale, p_timezone, 'pending_onboarding')
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

  insert into public.user_preferences (user_id, locale, timezone)
  values (v_uid, p_locale, p_timezone)
  on conflict (user_id) do update
  set locale = coalesce(excluded.locale, public.user_preferences.locale),
      timezone = coalesce(excluded.timezone, public.user_preferences.timezone);

  insert into public.onboarding_sessions (user_id, status, current_step, progress)
  values (v_uid, 'in_progress', '/onboarding/welcome', jsonb_build_object('checkpoint', '/onboarding/welcome'))
  on conflict (user_id) do nothing;

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

create or replace function public.upsert_onboarding_progress(
  p_current_step text,
  p_progress_json jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns public.onboarding_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.onboarding_sessions;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.onboarding_sessions (user_id, current_step, progress, status)
  values (v_uid, p_current_step, coalesce(p_progress_json, '{}'::jsonb), 'in_progress')
  on conflict (user_id) do update
  set current_step = excluded.current_step,
      progress = public.onboarding_sessions.progress || excluded.progress,
      status = case
        when public.onboarding_sessions.status = 'completed' then 'completed'
        else 'in_progress'
      end
  returning * into v_row;

  insert into public.user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do update
  set onboarding_answers = public.user_preferences.onboarding_answers || coalesce(p_progress_json, '{}'::jsonb);

  perform public.log_activity_event(
    p_event_name => 'upsert_onboarding_progress',
    p_payload => jsonb_build_object(
      'current_step', p_current_step,
      'progress', coalesce(p_progress_json, '{}'::jsonb)
    ),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

create or replace function public.complete_onboarding(
  p_answers_json jsonb default '{}'::jsonb,
  p_visibility_json jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns public.onboarding_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.onboarding_sessions;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do update
  set onboarding_answers = public.user_preferences.onboarding_answers || coalesce(p_answers_json, '{}'::jsonb),
      visibility = public.user_preferences.visibility || coalesce(p_visibility_json, '{}'::jsonb);

  update public.onboarding_sessions
  set status = 'completed',
      completed_at = now(),
      current_step = '/onboarding/end',
      progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object('checkpoint', '/onboarding/end')
  where user_id = v_uid
  returning * into v_row;

  if not found then
    insert into public.onboarding_sessions (user_id, status, current_step, progress, completed_at)
    values (v_uid, 'completed', '/onboarding/end', jsonb_build_object('checkpoint', '/onboarding/end'), now())
    returning * into v_row;
  end if;

  update public.users
  set status = 'active',
      onboarding_completed_at = now()
  where id = v_uid;

  update public.profiles
  set onboarding_completed_at = now()
  where id = v_uid;

  perform public.log_activity_event(
    p_event_name => 'complete_onboarding',
    p_payload => jsonb_build_object(
      'answers', coalesce(p_answers_json, '{}'::jsonb),
      'visibility', coalesce(p_visibility_json, '{}'::jsonb)
    ),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

create or replace function public.update_user_profile_public(
  p_profile_json jsonb,
  p_request_id uuid default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.user_profiles;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.user_profiles
  set display_name = coalesce(p_profile_json->>'display_name', display_name),
      bio = coalesce(p_profile_json->>'bio', bio),
      avatar_url = coalesce(p_profile_json->>'avatar_url', avatar_url),
      photos = case when p_profile_json ? 'photos' then coalesce(p_profile_json->'photos', photos) else photos end,
      profile_data = profile_data || coalesce(p_profile_json, '{}'::jsonb)
  where user_id = v_uid
  returning * into v_row;

  perform public.log_activity_event(
    p_event_name => 'update_user_profile_public',
    p_payload => coalesce(p_profile_json, '{}'::jsonb),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

create or replace function public.update_user_account_settings(
  p_locale text default null,
  p_timezone text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_request_id uuid default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.users;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.users (id)
  values (v_uid)
  on conflict (id) do nothing;

  update public.users
  set locale = coalesce(p_locale, locale),
      timezone = coalesce(p_timezone, timezone),
      first_name = coalesce(p_first_name, first_name),
      last_name = coalesce(p_last_name, last_name)
  where id = v_uid
  returning * into v_row;

  insert into public.user_preferences (user_id, locale, timezone)
  values (v_uid, p_locale, p_timezone)
  on conflict (user_id) do update
  set locale = coalesce(excluded.locale, public.user_preferences.locale),
      timezone = coalesce(excluded.timezone, public.user_preferences.timezone);

  perform public.log_activity_event(
    p_event_name => 'update_user_account_settings',
    p_payload => jsonb_build_object(
      'locale', p_locale,
      'timezone', p_timezone,
      'first_name', p_first_name,
      'last_name', p_last_name
    ),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

create or replace function public.accept_user_consent(
  p_consent_type text,
  p_version text,
  p_granted boolean,
  p_request_id uuid default null
)
returns public.user_consents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.user_consents;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_consents (user_id, consent_type, version, granted, granted_at, request_id)
  values (v_uid, p_consent_type, p_version, p_granted, now(), p_request_id)
  on conflict (user_id, consent_type, version) do update
  set granted = excluded.granted,
      granted_at = now(),
      request_id = excluded.request_id
  returning * into v_row;

  perform public.log_activity_event(
    p_event_name => 'accept_user_consent',
    p_payload => jsonb_build_object(
      'consent_type', p_consent_type,
      'version', p_version,
      'granted', p_granted
    ),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Compatibility wrappers for existing frontend
-- ---------------------------------------------------------------------------

create or replace function public.save_onboarding_progress(
  p_current_step text,
  p_progress jsonb
)
returns public.onboarding_sessions
language sql
security definer
set search_path = public
as $$
  select public.upsert_onboarding_progress(p_current_step, p_progress, null);
$$;

create or replace function public.complete_onboarding()
returns public.onboarding_sessions
language sql
security definer
set search_path = public
as $$
  select public.complete_onboarding('{}'::jsonb, '{}'::jsonb, null);
$$;

create or replace function public.upsert_user_data_section(
  p_section text,
  p_value jsonb default null,
  p_visible boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_visibility jsonb;
  v_answers jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select visibility, onboarding_answers
  into v_visibility, v_answers
  from public.user_preferences
  where user_id = v_uid;

  if p_visible is not null then
    v_visibility := coalesce(v_visibility, '{}'::jsonb) || jsonb_build_object(p_section || '_visible', p_visible);
  end if;

  if p_value is not null then
    v_answers := coalesce(v_answers, '{}'::jsonb) || jsonb_build_object(p_section || '_value', p_value);
  end if;

  update public.user_preferences
  set visibility = coalesce(v_visibility, '{}'::jsonb),
      onboarding_answers = coalesce(v_answers, '{}'::jsonb)
  where user_id = v_uid;

  return coalesce(v_answers, '{}'::jsonb) || coalesce(v_visibility, '{}'::jsonb);
end;
$$;

create or replace function public.set_user_data_visibility(
  p_section text,
  p_visible boolean
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.upsert_user_data_section(p_section, null, p_visible);
$$;

create or replace function public.get_or_create_user_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_visibility jsonb;
  v_answers jsonb;
  v_defaults jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select visibility, onboarding_answers
  into v_visibility, v_answers
  from public.user_preferences
  where user_id = v_uid;

  v_defaults := jsonb_build_object(
    'style_visible', true,
    'brands_visible', true,
    'motivation_visible', true,
    'experience_visible', true,
    'share_visible', true,
    'budget_visible', true,
    'dressing_visible', true,
    'ethic_visible', true,
    'privacy_visible', true,
    'looks_visible', true,
    'answers_visible', true
  );

  return v_defaults || coalesce(v_answers, '{}'::jsonb) || coalesce(v_visibility, '{}'::jsonb);
end;
$$;

grant execute on function public.log_activity_event(text, jsonb, uuid) to authenticated;
grant execute on function public.get_me_context() to authenticated;
grant execute on function public.bootstrap_user_after_signup(text, text, text, text, uuid) to authenticated;
grant execute on function public.upsert_onboarding_progress(text, jsonb, uuid) to authenticated;
grant execute on function public.complete_onboarding(jsonb, jsonb, uuid) to authenticated;
grant execute on function public.update_user_profile_public(jsonb, uuid) to authenticated;
grant execute on function public.update_user_account_settings(text, text, text, text, uuid) to authenticated;
grant execute on function public.accept_user_consent(text, text, boolean, uuid) to authenticated;
grant execute on function public.save_onboarding_progress(text, jsonb) to authenticated;
grant execute on function public.complete_onboarding() to authenticated;
grant execute on function public.upsert_user_data_section(text, jsonb, boolean) to authenticated;
grant execute on function public.set_user_data_visibility(text, boolean) to authenticated;
grant execute on function public.get_or_create_user_data() to authenticated;
