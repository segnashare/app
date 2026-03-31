/** Horodatage réservation panier pour le compteur 10 min sur /cart/payment. */
export const CART_RESERVED_AT_STORAGE_KEY = "segna:cart-reserved-at";

/** Nouvelle réservation réussie : toujours un départ de compteur à l’instant présent (évite un vieux timestamp sessionStorage → 0:00). */
export function setCartReservationTimerStart(nowMs: number = Date.now()): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CART_RESERVED_AT_STORAGE_KEY, String(nowMs));
}
