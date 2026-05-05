begin;

alter table public.users
  add column if not exists onboarding_mode text not null default 'real';

alter table public.users
  add column if not exists onboarding_started_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_onboarding_mode_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_onboarding_mode_check
      check (onboarding_mode in ('demo', 'bridge', 'real'));
  end if;
end
$$;

create table if not exists public.onboarding_progress (
  user_id uuid primary key references public.users(id) on delete cascade,
  current_step text not null default 'welcome',
  check_profile_done boolean not null default false,
  check_list_first_item_done boolean not null default false,
  check_style_size_done boolean not null default false,
  check_first_cart_done boolean not null default false,
  demo_seeded boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists onboarding_progress_completed_at_idx
  on public.onboarding_progress (completed_at);

create table if not exists public.onboarding_demo_state (
  user_id uuid primary key references public.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_onboarding_progress_set_updated_at on public.onboarding_progress;
create trigger trg_onboarding_progress_set_updated_at
before update on public.onboarding_progress
for each row execute function public.set_updated_at();

drop trigger if exists trg_onboarding_demo_state_set_updated_at on public.onboarding_demo_state;
create trigger trg_onboarding_demo_state_set_updated_at
before update on public.onboarding_demo_state
for each row execute function public.set_updated_at();

alter table public.onboarding_progress enable row level security;
alter table public.onboarding_demo_state enable row level security;

alter table public.onboarding_progress force row level security;
alter table public.onboarding_demo_state force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_select_own'
  ) then
    create policy onboarding_progress_select_own
      on public.onboarding_progress
      for select
      to authenticated
      using ((user_id = auth.uid()) or public.is_staff());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_insert_own'
  ) then
    create policy onboarding_progress_insert_own
      on public.onboarding_progress
      for insert
      to authenticated
      with check ((user_id = auth.uid()) or public.is_staff());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_update_own'
  ) then
    create policy onboarding_progress_update_own
      on public.onboarding_progress
      for update
      to authenticated
      using ((user_id = auth.uid()) or public.is_staff())
      with check ((user_id = auth.uid()) or public.is_staff());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_demo_state' and policyname = 'onboarding_demo_state_select_own'
  ) then
    create policy onboarding_demo_state_select_own
      on public.onboarding_demo_state
      for select
      to authenticated
      using ((user_id = auth.uid()) or public.is_staff());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_demo_state' and policyname = 'onboarding_demo_state_insert_own'
  ) then
    create policy onboarding_demo_state_insert_own
      on public.onboarding_demo_state
      for insert
      to authenticated
      with check ((user_id = auth.uid()) or public.is_staff());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_demo_state' and policyname = 'onboarding_demo_state_update_own'
  ) then
    create policy onboarding_demo_state_update_own
      on public.onboarding_demo_state
      for update
      to authenticated
      using ((user_id = auth.uid()) or public.is_staff())
      with check ((user_id = auth.uid()) or public.is_staff());
  end if;
end
$$;

commit;
