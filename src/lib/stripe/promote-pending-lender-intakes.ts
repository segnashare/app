import type Stripe from "stripe";

export type StripeMappedPlanCode = "guest" | "segna_plus" | "segna_x";

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
  const lender = mappedPlanCode === "segna_plus" || mappedPlanCode === "segna_x";
  if (!active || !lender) return;

  const { error } = await admin.rpc("promote_pre_subscribe_intakes_to_shipping_for_user", {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(error.message);
  }
}
