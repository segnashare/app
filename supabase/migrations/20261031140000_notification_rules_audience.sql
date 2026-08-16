-- Audience libre (events/status ∩/∪) pour notification_rules.

alter table public.notification_rules
  add column if not exists audience jsonb not null default '{}'::jsonb;

comment on column public.notification_rules.audience is
  'Audience libre : {combine: and|or, periodValue, periodUnit, predicates:[{atomId}]}';
