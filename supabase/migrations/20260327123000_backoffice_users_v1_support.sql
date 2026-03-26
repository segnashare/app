-- Backoffice Utilisateurs V1 support:
-- - user status values aligned with dashboard (pending, active, banned)
-- - moderation/deletion metadata on users
-- - challenges table for XP section

do $$
begin
  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'user_status'
  ) then
    begin
      alter type public.user_status add value if not exists 'pending';
    exception when others then
      null;
    end;
    begin
      alter type public.user_status add value if not exists 'banned';
    exception when others then
      null;
    end;
  end if;
end
$$;

alter table public.users
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists ban_reason text,
  add column if not exists deleted_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists delete_reason text,
  add column if not exists purge_after timestamptz;

update public.users
set purge_after = coalesce(purge_after, deleted_at + interval '6 months')
where deleted_at is not null;

create table if not exists public.xp_challenges (
  challenge_code text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text not null,
  description text,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

drop trigger if exists trg_xp_challenges_updated_at on public.xp_challenges;
create trigger trg_xp_challenges_updated_at
before update on public.xp_challenges
for each row execute function public.set_updated_at();
