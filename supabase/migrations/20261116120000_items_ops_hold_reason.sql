-- Motif hors catalogue quand status = listed (réparation / shooting / autre).
-- Nettoyé automatiquement dès que la pièce quitte listed.

alter table public.items
  add column if not exists ops_hold_reason text;

alter table public.items
  drop constraint if exists items_ops_hold_reason_check;

alter table public.items
  add constraint items_ops_hold_reason_check
  check (
    ops_hold_reason is null
    or ops_hold_reason in ('repair', 'shooting', 'other')
  );

comment on column public.items.ops_hold_reason is
  'Motif listed hors emprunt : repair | shooting | other. Null hors listed (ou listed sans motif).';

create index if not exists items_ops_hold_listed_idx
  on public.items (status, ops_hold_reason)
  where deleted_at is null and status in ('listed'::public.item_status, 'cleaning'::public.item_status);
