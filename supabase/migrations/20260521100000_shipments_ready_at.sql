-- Horodatage du passage en « prêt à expédier » (étiquette apposée) pour l’UI membre (date livraison prévue +2 j).

alter table public.shipments
  add column if not exists ready_at timestamptz;

comment on column public.shipments.ready_at is
  'Premier passage en statut ready (colis prêt / étiquette apposée). Null tant que pending.';
