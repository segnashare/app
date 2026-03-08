-- Additional user profile data captured from onboarding.
-- Each section keeps a value payload and a visibility boolean.

create table if not exists public.user_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  style_value jsonb not null default '{}'::jsonb,
  style_visible boolean not null default true,

  brands_value jsonb not null default '{}'::jsonb,
  brands_visible boolean not null default true,

  motivation_value jsonb not null default '{}'::jsonb,
  motivation_visible boolean not null default true,

  experience_value jsonb not null default '{}'::jsonb,
  experience_visible boolean not null default true,

  share_value jsonb not null default '{}'::jsonb,
  share_visible boolean not null default true,

  budget_value jsonb not null default '{}'::jsonb,
  budget_visible boolean not null default true,

  dressing_value jsonb not null default '{}'::jsonb,
  dressing_visible boolean not null default true,

  ethic_value jsonb not null default '{}'::jsonb,
  ethic_visible boolean not null default true,

  privacy_value jsonb not null default '{}'::jsonb,
  privacy_visible boolean not null default true,

  looks_value jsonb not null default '{}'::jsonb,
  looks_visible boolean not null default true,

  answers_value jsonb not null default '{}'::jsonb,
  answers_visible boolean not null default true
);

alter table public.user_data add column if not exists style_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists style_visible boolean not null default true;
alter table public.user_data add column if not exists brands_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists brands_visible boolean not null default true;
alter table public.user_data add column if not exists motivation_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists motivation_visible boolean not null default true;
alter table public.user_data add column if not exists experience_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists experience_visible boolean not null default true;
alter table public.user_data add column if not exists share_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists share_visible boolean not null default true;
alter table public.user_data add column if not exists budget_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists budget_visible boolean not null default true;
alter table public.user_data add column if not exists dressing_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists dressing_visible boolean not null default true;
alter table public.user_data add column if not exists ethic_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists ethic_visible boolean not null default true;
alter table public.user_data add column if not exists privacy_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists privacy_visible boolean not null default true;
alter table public.user_data add column if not exists looks_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists looks_visible boolean not null default true;
alter table public.user_data add column if not exists answers_value jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists answers_visible boolean not null default true;

drop trigger if exists trg_user_data_updated_at on public.user_data;
create trigger trg_user_data_updated_at
before update on public.user_data
for each row execute function public.set_updated_at();

alter table public.user_data enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
create policy "user_data_select_own"
on public.user_data
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_data_insert_own" on public.user_data;
create policy "user_data_insert_own"
on public.user_data
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_data_update_own" on public.user_data;
create policy "user_data_update_own"
on public.user_data
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update on public.user_data to authenticated;

create or replace function public.upsert_user_data_section(
  p_section text,
  p_value jsonb default null,
  p_visible boolean default null
)
returns public.user_data
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.user_data;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_section not in (
    'style',
    'brands',
    'motivation',
    'experience',
    'share',
    'budget',
    'dressing',
    'ethic',
    'privacy',
    'looks',
    'answers'
  ) then
    raise exception 'Invalid section %', p_section;
  end if;

  insert into public.user_data (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.user_data
  set
    style_value = case when p_section = 'style' then coalesce(p_value, style_value) else style_value end,
    style_visible = case when p_section = 'style' then coalesce(p_visible, style_visible) else style_visible end,
    brands_value = case when p_section = 'brands' then coalesce(p_value, brands_value) else brands_value end,
    brands_visible = case when p_section = 'brands' then coalesce(p_visible, brands_visible) else brands_visible end,
    motivation_value = case when p_section = 'motivation' then coalesce(p_value, motivation_value) else motivation_value end,
    motivation_visible = case when p_section = 'motivation' then coalesce(p_visible, motivation_visible) else motivation_visible end,
    experience_value = case when p_section = 'experience' then coalesce(p_value, experience_value) else experience_value end,
    experience_visible = case when p_section = 'experience' then coalesce(p_visible, experience_visible) else experience_visible end,
    share_value = case when p_section = 'share' then coalesce(p_value, share_value) else share_value end,
    share_visible = case when p_section = 'share' then coalesce(p_visible, share_visible) else share_visible end,
    budget_value = case when p_section = 'budget' then coalesce(p_value, budget_value) else budget_value end,
    budget_visible = case when p_section = 'budget' then coalesce(p_visible, budget_visible) else budget_visible end,
    dressing_value = case when p_section = 'dressing' then coalesce(p_value, dressing_value) else dressing_value end,
    dressing_visible = case when p_section = 'dressing' then coalesce(p_visible, dressing_visible) else dressing_visible end,
    ethic_value = case when p_section = 'ethic' then coalesce(p_value, ethic_value) else ethic_value end,
    ethic_visible = case when p_section = 'ethic' then coalesce(p_visible, ethic_visible) else ethic_visible end,
    privacy_value = case when p_section = 'privacy' then coalesce(p_value, privacy_value) else privacy_value end,
    privacy_visible = case when p_section = 'privacy' then coalesce(p_visible, privacy_visible) else privacy_visible end,
    looks_value = case when p_section = 'looks' then coalesce(p_value, looks_value) else looks_value end,
    looks_visible = case when p_section = 'looks' then coalesce(p_visible, looks_visible) else looks_visible end,
    answers_value = case when p_section = 'answers' then coalesce(p_value, answers_value) else answers_value end,
    answers_visible = case when p_section = 'answers' then coalesce(p_visible, answers_visible) else answers_visible end
  where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.set_user_data_visibility(
  p_section text,
  p_visible boolean
)
returns public.user_data
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_data;
begin
  v_row := public.upsert_user_data_section(
    p_section => p_section,
    p_value => null,
    p_visible => p_visible
  );
  return v_row;
end;
$$;

create or replace function public.get_or_create_user_data()
returns public.user_data
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.user_data;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_data (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select *
  into v_row
  from public.user_data
  where user_id = v_uid;

  return v_row;
end;
$$;

grant execute on function public.upsert_user_data_section(text, jsonb, boolean) to authenticated;
grant execute on function public.set_user_data_visibility(text, boolean) to authenticated;
grant execute on function public.get_or_create_user_data() to authenticated;
