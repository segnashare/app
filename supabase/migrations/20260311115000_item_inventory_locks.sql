-- Verrous temporaires article ↔ panier (TTL) pour reserve_cart_atomic / checkout Stripe.
-- Réintroduit si la table a été supprimée par erreur ; idempotent sur base déjà à jour.

create table if not exists public.item_inventory_locks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  cart_id uuid not null references public.carts (id) on delete cascade,
  locked_by_user_id uuid not null references public.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists item_inventory_locks_item_cart_user_uq
  on public.item_inventory_locks (item_id, cart_id, locked_by_user_id);

create index if not exists item_inventory_locks_cart_user_idx
  on public.item_inventory_locks (cart_id, locked_by_user_id);

create index if not exists item_inventory_locks_expires_at_idx
  on public.item_inventory_locks (expires_at);

comment on table public.item_inventory_locks is
  'Verrous d''inventaire par article et panier ; alignés sur le TTL du panier (reserve_cart_atomic).';
