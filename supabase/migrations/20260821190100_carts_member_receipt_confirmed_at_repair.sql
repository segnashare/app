-- Réparation : colonne parfois absente alors que 20260520120000 est déjà dans l’historique des migrations.

alter table public.carts
  add column if not exists member_receipt_confirmed_at timestamptz;

comment on column public.carts.member_receipt_confirmed_at is
  'Horodatage validation « bonne réception » (manuel ou auto 48h après livraison aller). NULL = page commande ; renseigné = page emprunt.';
