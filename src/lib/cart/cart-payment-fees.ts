import {
  CART_CHECKOUT_VAT_RATE,
  htToVatAndTtcCents,
  type computeCartFeesHtVatTtc,
} from "@/lib/cart/cart-checkout-vat";

/** Prochain montant TTC (centimes) se terminant par ,99 et ≥ au sous-total. */
export function roundCartPreServiceTotalUpToNext99Cents(preServiceTotalTtcCents: number): number {
  if (preServiceTotalTtcCents <= 0) return 99;
  const remainder = preServiceTotalTtcCents % 100;
  if (remainder === 99) return preServiceTotalTtcCents;
  const euros = Math.floor(preServiceTotalTtcCents / 100);
  return euros * 100 + 99;
}

/** Complément TTC de frais de service pour atteindre le ,99 supérieur (ex. 9,38 € → +0,61 € → 9,99 €). */
export function cartPaymentServiceComplementTtcCents(preServiceTotalTtcCents: number): number {
  const target = roundCartPreServiceTotalUpToNext99Cents(preServiceTotalTtcCents);
  return Math.max(0, target - preServiceTotalTtcCents);
}

export type CartCheckoutFeesPricing = ReturnType<typeof computeCartFeesHtVatTtc>;

/**
 * Livraison (HT → TTC) + complément d’échange (déjà TTC) + frais de service = arrondi au ,99 supérieur.
 * Aligné UI panier et Stripe Checkout.
 */
export function computeCartCheckoutFeesWithServiceRoundUp(
  shippingHtCents: number,
  creditsTtcCents: number,
): CartCheckoutFeesPricing {
  const ship = htToVatAndTtcCents(Math.max(0, shippingHtCents));
  const preServiceTtcCents = Math.max(0, creditsTtcCents) + ship.ttcCents;
  const serviceTtcCents = cartPaymentServiceComplementTtcCents(preServiceTtcCents);
  const serviceHtCents =
    serviceTtcCents > 0 ? Math.round(serviceTtcCents / (1 + CART_CHECKOUT_VAT_RATE)) : 0;
  const serviceVatCents = serviceTtcCents - serviceHtCents;

  return {
    shippingHtCents: Math.max(0, shippingHtCents),
    serviceHtCents,
    shippingVatCents: ship.vatCents,
    serviceVatCents,
    shippingTtcCents: ship.ttcCents,
    serviceTtcCents,
    feesHtCents: Math.max(0, shippingHtCents) + serviceHtCents,
    feesVatCents: ship.vatCents + serviceVatCents,
    feesTtcCents: ship.ttcCents + serviceTtcCents,
  };
}

/** Frais facturés au checkout : livraison HT facturée + complément service (éventuellement offert si échange inclus). */
export function computeCartCheckoutNetFees(args: {
  billedShippingHtCents: number;
  creditsTtcCents: number;
  /** Quand un échange inclus est consommé sur la commande, les frais de service ne sont pas facturés. */
  waiveServiceFeeForIncludedExchange: boolean;
}): CartCheckoutFeesPricing {
  const fees = computeCartCheckoutFeesWithServiceRoundUp(args.billedShippingHtCents, args.creditsTtcCents);
  if (!args.waiveServiceFeeForIncludedExchange || fees.serviceTtcCents <= 0) {
    return fees;
  }
  return {
    ...fees,
    serviceHtCents: 0,
    serviceVatCents: 0,
    serviceTtcCents: 0,
    feesHtCents: fees.shippingHtCents,
    feesVatCents: fees.shippingVatCents,
    feesTtcCents: fees.shippingTtcCents,
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
