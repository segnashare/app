-- Conditions / délais sur les règles BO + file d’attente d’envoi différé.

alter table public.notification_rules
  add column if not exists conditions jsonb not null default '[]'::jsonb;

alter table public.notification_rules
  add column if not exists send_delay_minutes integer not null default 0;

comment on column public.notification_rules.conditions is
  'Conditions activées [{id, enabled, delayMinutes?}].';
comment on column public.notification_rules.send_delay_minutes is
  'Délai d’envoi (minutes) après évaluation des conditions.';

create table if not exists public.notification_rule_queue (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.notification_rules (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  send_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  canceled_at timestamptz,
  constraint notification_rule_queue_idempotency_key unique (idempotency_key)
);

create index if not exists notification_rule_queue_due_idx
  on public.notification_rule_queue (send_at)
  where sent_at is null and canceled_at is null;

comment on table public.notification_rule_queue is
  'Envois différés pour notification_rules (conditions + délais).';

alter table public.notification_rule_queue enable row level security;

revoke all on table public.notification_rule_queue from anon, authenticated;
grant select, insert, update, delete on table public.notification_rule_queue to service_role;
