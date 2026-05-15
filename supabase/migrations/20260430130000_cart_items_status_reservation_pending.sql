-- Ajoute cart_items.status = reservation_pending (voir reserve_cart_atomic).

alter table public.cart_items drop constraint if exists cart_items_status_check;
alter table public.cart_items add constraint cart_items_status_check
  check (
    status in (
      'in_cart'::public.cart_item_status,
      'reserved'::public.cart_item_status,
      'archived'::public.cart_item_status,
      'reservation_pending'::public.cart_item_status
    )
  );
