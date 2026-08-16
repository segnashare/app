-- Activation / désactivation des types de notifications définis dans le code.

create table if not exists public.notification_kind_settings (
  kind text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null
);

comment on table public.notification_kind_settings is
  'Préférences BO : activer/désactiver un kind de notification code. Absence de ligne = activé.';

alter table public.notification_kind_settings enable row level security;

revoke all on table public.notification_kind_settings from anon, authenticated;
grant select, insert, update, delete on table public.notification_kind_settings to service_role;
