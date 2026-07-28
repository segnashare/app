/** Logos transporteur checkout — même source que les options domicile. */

export const CHECKOUT_CHRONOPOST_ICON_SRC = "/ressources/carriers/chronopost-icon.png";

export function normalizeCheckoutCarrierCode(carrier: string | null | undefined): string {
  return (carrier ?? "").trim().toLowerCase();
}

export function isCheckoutChronopostCarrier(carrier: string | null | undefined): boolean {
  const c = normalizeCheckoutCarrierCode(carrier);
  return c === "chronopost" || c.includes("chrono");
}

export function isCheckoutMondialRelayCarrier(carrier: string | null | undefined): boolean {
  const c = normalizeCheckoutCarrierCode(carrier);
  return c === "mondial_relay" || c.includes("mondial");
}

/**
 * Même règles que `CheckoutHomePlanCarrierIcon` :
 * - Chronopost → icône locale
 * - sinon → `carrierLogoUrl` Sendcloud (ex. Mondial Relay)
 */
export function resolveCheckoutCarrierLogoSrc(params: {
  carrier?: string | null;
  methodKey?: "chronopost" | "domestic" | string | null;
  logoUrl?: string | null;
}): string | null {
  if (params.methodKey === "chronopost" || isCheckoutChronopostCarrier(params.carrier)) {
    return CHECKOUT_CHRONOPOST_ICON_SRC;
  }
  const remote = params.logoUrl?.trim() || null;
  return remote || null;
}
