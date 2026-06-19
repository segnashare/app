/**
 * TVA sur les frais panier (livraison), barèmes saisis en HT.
 * Taux standard France (services / transport).
 */
export const CART_CHECKOUT_VAT_RATE = 0.2;

export const CART_CHECKOUT_VAT_LABEL = "TVA (20 %)";

export function htToVatAndTtcCents(htCents: number): { vatCents: number; ttcCents: number } {
  const vatCents = Math.round(htCents * CART_CHECKOUT_VAT_RATE);
  return { vatCents, ttcCents: htCents + vatCents };
}

/** Livraison (aller-retour + éventuelle option Uber Direct) : HT → TVA arrondie, TTC par ligne (aligné Stripe). */
export function computeCartFeesHtVatTtc(shippingHtCents: number, serviceHtCents: number) {
  const ship = htToVatAndTtcCents(shippingHtCents);
  const srv = htToVatAndTtcCents(serviceHtCents);
  return {
    shippingHtCents: shippingHtCents,
    serviceHtCents: serviceHtCents,
    shippingVatCents: ship.vatCents,
    serviceVatCents: srv.vatCents,
    shippingTtcCents: ship.ttcCents,
    serviceTtcCents: srv.ttcCents,
    feesHtCents: shippingHtCents + serviceHtCents,
    feesVatCents: ship.vatCents + srv.vatCents,
    feesTtcCents: ship.ttcCents + srv.ttcCents,
  };
}
