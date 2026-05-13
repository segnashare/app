-- Détail des canaux effectivement utilisés après envoi : none | email | phone | email+phone

alter table public.notification_send_log
  add column if not exists delivery_channels text;

update public.notification_send_log
set delivery_channels = 'none'
where delivery_channels is null;

alter table public.notification_send_log
  alter column delivery_channels set default 'none';

alter table public.notification_send_log
  alter column delivery_channels set not null;

alter table public.notification_send_log
  drop constraint if exists notification_send_log_delivery_channels_check;

alter table public.notification_send_log
  add constraint notification_send_log_delivery_channels_check
  check (delivery_channels in ('none', 'email', 'phone', 'email+phone'));

comment on column public.notification_send_log.delivery_channels is
  'Canal(s) ayant reçu le message : email, phone (SMS seul), email+phone, none (claim sans envoi réussi).';
