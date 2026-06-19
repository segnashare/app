import {
  htToVatAndTtcCents,
  type computeCartFeesHtVatTtc,
} from "@/lib/cart/cart-checkout-vat";

export type CartCheckoutFeesPricing = ReturnType<typeof computeCartFeesHtVatTtc>;

/** Livraison HT → TTC (aligné UI panier et Stripe Checkout). */
export function computeCartCheckoutShippingFees(shippingHtCents: number): CartCheckoutFeesPricing {
  const ship = htToVatAndTtcCents(Math.max(0, shippingHtCents));
  return {
    shippingHtCents: Math.max(0, shippingHtCents),
    serviceHtCents: 0,
    shippingVatCents: ship.vatCents,
    serviceVatCents: 0,
    shippingTtcCents: ship.ttcCents,
    serviceTtcCents: 0,
    feesHtCents: Math.max(0, shippingHtCents),
    feesVatCents: ship.vatCents,
    feesTtcCents: ship.ttcCents,
  };
}

export type CartCheckoutIncludedFeeReductions = {
  serviceTtcCents: number;
  shippingTtcCents: number;
  totalTtcCents: number;
};

/** Réductions TTC affichées en vert (barème plein − montant facturé). */
export function computeCartCheckoutIncludedFeeReductions(
  grossFees: CartCheckoutFeesPricing,
  netFees: CartCheckoutFeesPricing,
): CartCheckoutIncludedFeeReductions {
  const serviceTtcCents = Math.max(0, grossFees.serviceTtcCents - netFees.serviceTtcCents);
  const shippingTtcCents = Math.max(0, grossFees.shippingTtcCents - netFees.shippingTtcCents);
  return {
    serviceTtcCents,
    shippingTtcCents,
    totalTtcCents: serviceTtcCents + shippingTtcCents,
  };
}
