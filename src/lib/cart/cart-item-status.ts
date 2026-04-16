/**
 * Miroir du type Postgres `public.cart_item_status` (colonne `cart_items.status`).
 * Régénérer les types Supabase après migration pour les requêtes typées.
 */
export const CART_ITEM_STATUSES = [
  "in_cart",
  "reserved",
  "archived",
  "reservation_pending",
  "verification_pending",
  "verified",
  "rejected",
] as const;

export type CartItemStatus = (typeof CART_ITEM_STATUSES)[number];
