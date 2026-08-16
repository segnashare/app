-- Règles de notifications marketing créées depuis le BO (référentiel).

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  trigger_event text not null,
  title_template text not null,
  body_template text not null,
  channels text[] not null default array['push']::text[],
  enabled boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notification_rules_active_trigger_idx
  on public.notification_rules (trigger_event)
  where deleted_at is null and enabled = true;

comment on table public.notification_rules is
  'Règles push marketing configurables depuis le backoffice (templates + événement déclencheur).';

alter table public.notification_rules enable row level security;

revoke all on table public.notification_rules from anon, authenticated;
grant select, insert, update, delete on table public.notification_rules to service_role;
