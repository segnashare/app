-- Détail libre pour pièces hors emprunt (pressing / listed).

alter table public.items
  add column if not exists ops_hold_note text;

comment on column public.items.ops_hold_note is
  'Détail libre hors emprunt (où est le pressing, quoi réparer, etc.). Null si hors hold.';
