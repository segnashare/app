import type Stripe from "stripe";

/**
 * Compte App Review : abonnement activé à 0 € (coupon 100 % forever),
 * sans empreinte bancaire SegnaX. Pas de SegnaX pré-attribué.
 */
const DEFAULT_APPLE_REVIEW_COMP_EMAILS = ["review@segnashare.com"] as const;

const COUPON_ID = "segna_apple_review_comp_100";

function parseAllowlist(): Set<string> {
  const fromEnv = (process.env.APPLE_REVIEW_COMP_CHECKOUT_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_APPLE_REVIEW_COMP_EMAILS, ...fromEnv]);
}

export function isAppleReviewCompCheckoutEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== "string") return false;
  return parseAllowlist().has(email.trim().toLowerCase());
}

/** Coupon Stripe 100 % forever, id stable — uniquement pour le checkout review. */
export async function resolveAppleReviewCompCouponId(stripe: Stripe): Promise<string> {
  try {
    const existing = await stripe.coupons.retrieve(COUPON_ID);
    if (!existing.deleted) return existing.id;
  } catch {
    // Pas encore créé.
  }
  const created = await stripe.coupons.create({
    id: COUPON_ID,
    percent_off: 100,
    duration: "forever",
    name: "Apple Review — abonnement offert",
  });
  return created.id;
}
