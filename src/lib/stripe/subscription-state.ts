import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { promotePendingLenderIntakesAfterStripeSubscription } from "@/lib/stripe/promote-pending-lender-intakes";

type PlanCode = "guest" | "segna_plus" | "segna_x";

function isPlanCode(value: string | null | undefined): value is PlanCode {
  return value === "guest" || value === "segna_plus" || value === "segna_x";
}

function unixToIso(value: number | null | undefined): string | null {
  if (!value || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

async function getMappedPlanCodeFromSubscription(admin: any, subscription: Stripe.Subscription): Promise<PlanCode> {
  const stripePriceId = subscription.items.data[0]?.price?.id ?? null;

  if (stripePriceId) {
    const { data: mappedRow } = await admin
      .from("billing_plan_prices")
      .select("plan_code")
      .eq("stripe_price_id", stripePriceId)
      .maybeSingle();

    if (isPlanCode(mappedRow?.plan_code)) {
      return mappedRow.plan_code;
    }
  }

  const metadataPlan = subscription.metadata?.plan_code;
  if (isPlanCode(metadataPlan)) return metadataPlan;
  return "guest";
}

export async function upsertBillingCustomer(admin: any, userId: string, stripeCustomerId: string, metadata?: Record<string, unknown>) {
  await admin.from("billing_customers").upsert(
    {
      user_id: userId,
      provider: "stripe",
      provider_customer_id: stripeCustomerId,
      metadata: metadata ?? {},
    },
    { onConflict: "user_id" },
  );
}

export async function upsertSubscriptionAndEntitlements(
  admin: any,
  userId: string,
  stripeCustomerId: string | null,
  subscription: Stripe.Subscription,
) {
  const planCode = await getMappedPlanCodeFromSubscription(admin, subscription);
  const entitlementPlan: PlanCode = subscription.status === "active" || subscription.status === "trialing" ? planCode : "guest";

  const firstItem = subscription.items.data[0];
  const currentPeriodStart = firstItem?.current_period_start ?? null;
  const currentPeriodEnd = firstItem?.current_period_end ?? null;

  await admin.from("user_subscriptions").upsert(
    {
      user_id: userId,
      provider: "stripe",
      provider_customer_id: stripeCustomerId,
      provider_subscription_id: subscription.id,
      plan_code: planCode,
      status: subscription.status,
      current_period_start: unixToIso(currentPeriodStart),
      current_period_end: unixToIso(currentPeriodEnd),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      canceled_at: unixToIso(subscription.canceled_at),
      trial_start: unixToIso(subscription.trial_start),
      trial_end: unixToIso(subscription.trial_end),
      metadata: subscription.metadata ?? {},
      raw_payload: subscription as unknown as Record<string, unknown>,
    },
    { onConflict: "user_id,provider" },
  );

  await admin.rpc("billing_upsert_monthly_entitlement", {
    p_user_id: userId,
    p_plan_code: entitlementPlan,
  });

  await promotePendingLenderIntakesAfterStripeSubscription(admin, userId, subscription, planCode);
}

async function markSubscriptionCanceledLocally(admin: any, userId: string, stripeCustomerId: string, providerSubscriptionId: string) {
  await admin.from("user_subscriptions").upsert(
    {
      user_id: userId,
      provider: "stripe",
      provider_customer_id: stripeCustomerId,
      provider_subscription_id: providerSubscriptionId,
      plan_code: "guest",
      status: "canceled",
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      canceled_at: new Date().toISOString(),
      trial_start: null,
      trial_end: null,
      metadata: {},
      raw_payload: {},
    },
    { onConflict: "user_id,provider" },
  );

  await admin.rpc("billing_upsert_monthly_entitlement", {
    p_user_id: userId,
    p_plan_code: "guest",
  });
}

/**
 * Re-lit l’état d’abonnement depuis Stripe (abonnement supprimé / annulé hors webhook, ex. dev local).
 * À appeler côté serveur avec le service role pour l’utilisateur connecté uniquement.
 */
export async function refreshStripeSubscriptionForUser(admin: any, userId: string): Promise<void> {
  const { data: billingRow } = await admin
    .from("billing_customers")
    .select("provider_customer_id")
    .eq("user_id", userId)
    .eq("provider", "stripe")
    .maybeSingle();

  const customerId = typeof billingRow?.provider_customer_id === "string" ? billingRow.provider_customer_id.trim() : "";
  if (!customerId) return;

  const { secretKey } = getStripeConfig();
  const stripe = new Stripe(secretKey);

  const { data: subRow } = await admin
    .from("user_subscriptions")
    .select("provider_subscription_id")
    .eq("user_id", userId)
    .eq("provider", "stripe")
    .maybeSingle();

  const storedSubId = typeof subRow?.provider_subscription_id === "string" ? subRow.provider_subscription_id.trim() : "";

  if (storedSubId) {
    try {
      const sub = await stripe.subscriptions.retrieve(storedSubId);
      await upsertSubscriptionAndEntitlements(admin, userId, customerId, sub);
      return;
    } catch (e) {
      const missing =
        e instanceof Stripe.errors.StripeInvalidRequestError && (e.code === "resource_missing" || e.statusCode === 404);
      if (!missing) throw e;
    }
  }

  const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 30 });
  const byCreatedDesc = (a: Stripe.Subscription, b: Stripe.Subscription) => b.created - a.created;
  const activeish = list.data
    .filter((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due")
    .sort(byCreatedDesc)[0];
  const fallback = activeish ?? [...list.data].sort(byCreatedDesc)[0];

  if (fallback) {
    await upsertSubscriptionAndEntitlements(admin, userId, customerId, fallback);
    return;
  }

  if (storedSubId) {
    await markSubscriptionCanceledLocally(admin, userId, customerId, storedSubId);
  }
}
