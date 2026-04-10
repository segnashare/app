import Stripe from "stripe";

export type CartCheckoutPaymentDetail = {
  complementCreditsEuros: number;
  serviceFeeEuros: number;
  shippingFeeEuros: number;
  /** Montant total encaissé sur la session Checkout (TTC, après promo éventuelle). */
  totalPaidEuros: number;
  /** TVA sur les frais (metadata checkout). */
  feesVatEuros?: number;
  /** Frais TTC additionnels agrégés (metadata checkout). */
  feesTtcEuros?: number;
};

function metaCents(metadata: Stripe.Metadata | null, key: string): number {
  if (!metadata) return 0;
  const n = Number(metadata[key]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lit les montants TTC enregistrés dans les metadata Checkout (aligné sur `/api/stripe/cart/checkout`).
 */
export async function fetchCartCheckoutPaymentDetail(
  checkoutSessionId: string | null | undefined,
): Promise<CartCheckoutPaymentDetail | null> {
  const sid = checkoutSessionId?.trim();
  if (!sid) return null;

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;

  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sid);
    if ((session.metadata?.checkout_kind ?? "") !== "cart_order") {
      return null;
    }

    const md = session.metadata;
    const creditsCents = metaCents(md, "credits_line_cents");
    const serviceTtcCents = metaCents(md, "service_ttc_cents");
    const shippingTtcCents = metaCents(md, "shipping_ttc_cents");
    const amountTotalCents = typeof session.amount_total === "number" ? session.amount_total : 0;
    const feesVatCents = metaCents(md, "fees_vat_cents");
    const feesTtcCents = metaCents(md, "fees_ttc_cents");

    return {
      complementCreditsEuros: creditsCents / 100,
      serviceFeeEuros: serviceTtcCents / 100,
      shippingFeeEuros: shippingTtcCents / 100,
      totalPaidEuros: amountTotalCents / 100,
      ...(feesVatCents > 0 ? { feesVatEuros: feesVatCents / 100 } : {}),
      ...(feesTtcCents > 0 ? { feesTtcEuros: feesTtcCents / 100 } : {}),
    };
  } catch {
    return null;
  }
}
