export const CART_RENTAL_RELAY_FREE_THRESHOLD_EUR = 50;
export const CART_PURCHASE_RELAY_FREE_THRESHOLD_EUR = 200;

/** @deprecated Préférer {@link cartRelayFreeThresholdEuros}. */
export const CART_COMPLEMENT_RELAY_FREE_THRESHOLD_EUR = CART_RENTAL_RELAY_FREE_THRESHOLD_EUR;

export type CartRelayFreeOfferMode = "location" | "achat";

export function cartRelayFreeThresholdEuros(mode: CartRelayFreeOfferMode = "location"): number {
  return mode === "achat" ? CART_PURCHASE_RELAY_FREE_THRESHOLD_EUR : CART_RENTAL_RELAY_FREE_THRESHOLD_EUR;
}

export function complementQualifiesForFreeRelay(
  complementEuros: number,
  mode: CartRelayFreeOfferMode = "location",
): boolean {
  return complementEuros >= cartRelayFreeThresholdEuros(mode);
}

export function complementRelayOfferMissingEuros(
  complementEuros: number,
  mode: CartRelayFreeOfferMode = "location",
): number {
  return Math.max(0, cartRelayFreeThresholdEuros(mode) - complementEuros);
}

/** Progression vers le seuil livraison offerte (0–1). */
export function complementRelayOfferProgressRatio(
  complementEuros: number,
  mode: CartRelayFreeOfferMode = "location",
): number {
  const threshold = cartRelayFreeThresholdEuros(mode);
  if (threshold <= 0) return 1;
  return Math.min(1, Math.max(0, complementEuros / threshold));
}

export function cartRelayFreeOfferUnlockedSubtext(mode?: CartRelayFreeOfferMode): string {
  if (mode === "achat") {
    return `Débloquée dès ${CART_PURCHASE_RELAY_FREE_THRESHOLD_EUR}\u00A0€ d'achat.`;
  }
  if (mode === "location") {
    return `Débloquée dès ${CART_RENTAL_RELAY_FREE_THRESHOLD_EUR}\u00A0€ de location.`;
  }
  return `Débloquée dès ${CART_RENTAL_RELAY_FREE_THRESHOLD_EUR}\u00A0€ de location et ${CART_PURCHASE_RELAY_FREE_THRESHOLD_EUR}\u00A0€ d'achat.`;
}

export function formatCartComplementMissingEuros(missingEuros: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, missingEuros));
}
