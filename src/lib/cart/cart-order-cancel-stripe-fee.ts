/**
 * Frais d’annulation sur le montant carte (TTC) — uniquement si la cliente annule.
 * Annulation initiée côté back-office : taux 0 (remboursement 100 %).
 */
export const CART_ORDER_CANCEL_STRIPE_FEE_RATE_MEMBER = 0.2;

/** @deprecated alias — taux membre (80 % remboursé). */
export const CART_ORDER_CANCEL_STRIPE_FEE_RATE = CART_ORDER_CANCEL_STRIPE_FEE_RATE_MEMBER;

export const CART_ORDER_CANCEL_STRIPE_FEE_RATE_BACKOFFICE = 0;

export function stripeCancelFeeBreakdownFromTotalCents(
  totalCents: number,
  feeRate: number = CART_ORDER_CANCEL_STRIPE_FEE_RATE_MEMBER,
): {
  feeCents: number;
  refundCents: number;
} {
  const t = Math.max(0, Math.trunc(totalCents));
  if (t <= 0) return { feeCents: 0, refundCents: 0 };
  const rate = Math.min(1, Math.max(0, Number(feeRate) || 0));
  const feeCents = Math.round(t * rate);
  const refundCents = Math.max(0, t - feeCents);
  return { feeCents, refundCents };
}
