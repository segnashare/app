import type Stripe from "stripe";

/** Remise 1er mois (ex. −50 %) : coupon Stripe `duration: once`, id stable. */
export function normalizeFirstMonthPercentOff(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(String(raw).trim(), 10) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const percent = Math.floor(n);
  if (percent < 1 || percent > 100) return undefined;
  return percent;
}

/**
 * Coupon idempotent `segna_first_month_{percent}` pour appliquer −N % sur la 1ʳᵉ facture.
 */
export async function resolveFirstMonthPercentOffCouponId(
  stripe: Stripe,
  percentOff: number,
): Promise<string> {
  const id = `segna_first_month_${percentOff}`;
  try {
    const existing = await stripe.coupons.retrieve(id);
    if (!existing.deleted) return existing.id;
  } catch {
    // Pas encore créé.
  }
  const created = await stripe.coupons.create({
    id,
    percent_off: percentOff,
    duration: "once",
    name: `−${percentOff} % 1er mois`,
  });
  return created.id;
}
