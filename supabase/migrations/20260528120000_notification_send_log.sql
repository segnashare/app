-- Journal d’idempotence pour notifications transactionnelles (Resend / Twilio).
-- Une ligne = une « place » consommée pour une clé métier (ex. une commande panier).

create table if not exists public.notification_send_log (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  kind text not null,
  user_id uuid not null references public.users (id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint notification_send_log_idempotency_key_key unique (idempotency_key)
);

create index if not exists notification_send_log_user_created_idx
  on public.notification_send_log (user_id, created_at desc);

comment on table public.notification_send_log is
  'Déduplication envois e-mail/SMS (une entrée par idempotency_key). Remplie côté service_role uniquement.';

alter table public.notification_send_log enable row level security;

revoke all on table public.notification_send_log from anon, authenticated;

grant select, insert, delete, update on table public.notification_send_log to service_role;
