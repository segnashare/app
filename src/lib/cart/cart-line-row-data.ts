import type { CartLineStatus } from "@/lib/cart/cart-line-status";

export type CartLineRowData = {
  id: string;
  itemId: string;
  itemName: string;
  brand: string | null;
  description: string | null;
  pricePoints: number;
  status: CartLineStatus;
  photoUrl: string | null;
  photoPosition: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
  /** Autres paniers actifs avec la même pièce (cart_items.status = in_cart). */
  otherShoppersInCart?: number;
  /** items.status = reserved par un autre membre (pas ta ligne réservée). */
  reservedByOther?: boolean;
  /** `carts.locked_until` du panier concurrent (ISO), pour compteur fin de réservation. */
  reservedUntilAt?: string | null;
};
