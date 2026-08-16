-- Résolution BO litige pièce : barème défaut, facturation, alerte membre, historique.
alter table public.item_disputes
  add column if not exists resolution jsonb not null default '{}'::jsonb;

comment on column public.item_disputes.resolution is
  'Résolution BO litige item : defect_tier, billing_percent, billed_points, member_alert, history, item_action…';

create index if not exists item_disputes_resolution_alert_pending_idx
  on public.item_disputes ((resolution -> 'memberAlert' ->> 'status'))
  where deleted_at is null
    and coalesce(resolution -> 'memberAlert' ->> 'status', '') = 'pending';
