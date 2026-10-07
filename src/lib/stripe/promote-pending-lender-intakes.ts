import type Stripe from "stripe";

import { isPaidPlanCode, type BillingPlanCode } from "@/lib/billing/plan-codes";

export type StripeMappedPlanCode = BillingPlanCode;

/**
 * Après synchro Stripe : appelle encore la RPC (no-op côté base) pour compat ; le prêt ne dépend plus d’un stade « abonnement ».
 */
export async function promotePendingLenderIntakesAfterStripeSubscription(
  admin: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> },
  userId: string,
  subscription: Stripe.Subscription,
  mappedPlanCode: StripeMappedPlanCode,
): Promise<void> {
  const st = (subscription.status ?? "").toLowerCase();
  const active = st === "active" || st === "trialing";
  const lender = isPaidPlanCode(mappedPlanCode);
  if (!active || !lender) return;

  const { error } = await admin.rpc("promote_pre_subscribe_intakes_to_shipping_for_user", {
    p_user_id: userId,
  });
  if (error) {
    // Ne bloque pas la confirmation d’abonnement (RPC best-effort).
    console.error("[stripe] promote pending lender intakes", error.message);
  }
}
