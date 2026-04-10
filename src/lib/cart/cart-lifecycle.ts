/**
 * Constantes alignées sur l’enum Postgres `cart_status` (migration checkout_pending / confirmed).
 * @see supabase/migrations/20260513120000_cart_checkout_pending_shipment_context_drop_wallet_holds.sql
 */

/** Même panier : édition catalogue + passage au checkout (locked_until). */
export const CART_STATUSES_OPEN = ["active", "checkout_pending"] as const;

/** Historique « commande » : hors brouillon et hors session checkout. */
export const CART_STATUSES_HISTORY = ["confirmed", "archived", "canceled"] as const;

export type CartStatusOpen = (typeof CART_STATUSES_OPEN)[number];
export type CartStatusHistory = (typeof CART_STATUSES_HISTORY)[number];
