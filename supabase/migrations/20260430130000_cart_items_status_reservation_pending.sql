-- Ajoute cart_items.status = reservation_pending (voir reserve_cart_atomic).

alter table public.cart_items drop constraint if exists cart_items_status_check;
alter table public.cart_items add constraint cart_items_status_check
  check (status = any (array['in_cart'::text, 'reserved'::text, 'archived'::text, 'reservation_pending'::text]));
