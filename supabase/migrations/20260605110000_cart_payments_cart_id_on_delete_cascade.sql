-- Supprimer un panier supprime aussi les lignes cart_payments liées (éditeur / maintenance).
alter table public.cart_payments
  drop constraint if exists cart_payments_cart_id_fkey;

alter table public.cart_payments
  add constraint cart_payments_cart_id_fkey
  foreign key (cart_id) references public.carts (id) on delete cascade;
