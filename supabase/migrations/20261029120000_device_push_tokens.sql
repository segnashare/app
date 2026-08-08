-- Jetons Expo Push (APNs / FCM via Expo) pour l’app native.

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  device_id text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint device_push_tokens_expo_push_token_key unique (expo_push_token)
);

create index if not exists device_push_tokens_user_active_idx
  on public.device_push_tokens (user_id)
  where disabled_at is null;

comment on table public.device_push_tokens is
  'Tokens Expo Push enregistrés par l’app native ; disabled_at si DeviceNotRegistered.';

alter table public.device_push_tokens enable row level security;

-- Accès applicatif via service_role (API Next) ; pas de policies user directes.
revoke all on table public.device_push_tokens from anon, authenticated;
grant select, insert, update, delete on table public.device_push_tokens to service_role;

-- Étend le journal d’envoi pour tracer le canal push.
alter table public.notification_send_log
  drop constraint if exists notification_send_log_delivery_channels_check;

alter table public.notification_send_log
  add constraint notification_send_log_delivery_channels_check
  check (
    delivery_channels in (
      'none',
      'email',
      'phone',
      'email+phone',
      'push',
      'email+push',
      'phone+push',
      'email+phone+push'
    )
  );

comment on column public.notification_send_log.delivery_channels is
  'Canal(s) ayant reçu le message : email, phone (SMS), push, combinaisons, none.';
