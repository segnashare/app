/** Part du montant carte (TTC) conservée comme frais d’annulation (le reste est remboursé sur Stripe). */
export const CART_ORDER_CANCEL_STRIPE_FEE_RATE = 0.2;

export function stripeCancelFeeBreakdownFromTotalCents(totalCents: number): {
  feeCents: number;
  refundCents: number;
} {
  const t = Math.max(0, Math.trunc(totalCents));
  if (t <= 0) return { feeCents: 0, refundCents: 0 };
  const feeCents = Math.round(t * CART_ORDER_CANCEL_STRIPE_FEE_RATE);
  const refundCents = Math.max(0, t - feeCents);
  return { feeCents, refundCents };
}
