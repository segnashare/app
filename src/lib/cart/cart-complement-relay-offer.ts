/** Complément € (location) à partir duquel la livraison point relais est offerte au checkout. */
export const CART_COMPLEMENT_RELAY_FREE_THRESHOLD_EUR = 20;

export function complementQualifiesForFreeRelay(complementEuros: number): boolean {
  return complementEuros >= CART_COMPLEMENT_RELAY_FREE_THRESHOLD_EUR;
}

export function complementRelayOfferMissingEuros(complementEuros: number): number {
  return Math.max(0, CART_COMPLEMENT_RELAY_FREE_THRESHOLD_EUR - complementEuros);
}

/** Progression vers le seuil livraison offerte (0–1). */
export function complementRelayOfferProgressRatio(complementEuros: number): number {
  if (CART_COMPLEMENT_RELAY_FREE_THRESHOLD_EUR <= 0) return 1;
  return Math.min(
    1,
    Math.max(0, complementEuros / CART_COMPLEMENT_RELAY_FREE_THRESHOLD_EUR),
  );
}

export function formatCartComplementMissingEuros(missingEuros: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, missingEuros));
}
