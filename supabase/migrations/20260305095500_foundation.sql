-- Foundation schema for auth + onboarding (phase 0).
create extension if not exists "pgcrypto";
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_name text,
  last_name text,
  locale text,
  timezone text,
  onboarding_completed_at timestamptz
);
create table if not exists public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft', 'completed', 'abandoned')),
  current_step text not null default 'welcome',
  progress jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  unique (user_id)
);
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists trg_onboarding_sessions_updated_at on public.onboarding_sessions;
create trigger trg_onboarding_sessions_updated_at
before update on public.onboarding_sessions
for each row execute function public.set_updated_at();
alter table public.profiles enable row level security;
alter table public.onboarding_sessions enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());
drop policy if exists "onboarding_sessions_select_own" on public.onboarding_sessions;
create policy "onboarding_sessions_select_own"
on public.onboarding_sessions
for select
to authenticated
using (user_id = auth.uid());
drop policy if exists "onboarding_sessions_insert_own" on public.onboarding_sessions;
create policy "onboarding_sessions_insert_own"
on public.onboarding_sessions
for insert
to authenticated
with check (user_id = auth.uid());
drop policy if exists "onboarding_sessions_update_own" on public.onboarding_sessions;
create policy "onboarding_sessions_update_own"
on public.onboarding_sessions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.onboarding_sessions to authenticated;
create or replace function public.save_onboarding_progress(
  p_current_step text,
  p_progress jsonb
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
  values (v_uid, p_current_step, coalesce(p_progress, '{}'::jsonb), 'draft')
  on conflict (user_id) do update
  set current_step = excluded.current_step,
      progress = public.onboarding_sessions.progress || excluded.progress,
      status = case
        when public.onboarding_sessions.status = 'completed' then 'completed'
        else 'draft'
      end
  returning * into v_row;

  return v_row;
end;
$$;
create or replace function public.complete_onboarding()
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

  update public.onboarding_sessions
  set status = 'completed',
      completed_at = now()
  where user_id = v_uid
  returning * into v_row;

  if not found then
    raise exception 'Onboarding session not found for current user';
  end if;

  update public.profiles
  set onboarding_completed_at = now()
  where id = v_uid;

  return v_row;
end;
$$;
grant execute on function public.save_onboarding_progress(text, jsonb) to authenticated;
grant execute on function public.complete_onboarding() to authenticated;
