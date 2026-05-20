-- Validation membre : bonne réception de la commande (après livraison aller).

alter table public.carts
  add column if not exists member_receipt_confirmed_at timestamptz;

comment on column public.carts.member_receipt_confirmed_at is
  'Horodatage de la validation « bonne réception » par le membre (page commande après delivered).';
