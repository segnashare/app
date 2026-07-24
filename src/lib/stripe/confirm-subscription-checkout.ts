import Stripe from "stripe";

import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSegnaXSubscriptionBankHoldIfNeeded } from "@/lib/stripe/segnax-subscription-bank-hold";
import { upsertBillingCustomer, upsertSubscriptionAndEntitlements } from "@/lib/stripe/subscription-state";

function isPlanCode(value: string | null | undefined): value is "guest" | "segna_plus" | "segna_x" {
  return value === "guest" || value === "segna_plus" || value === "segna_x";
}

export type ConfirmSubscriptionCheckoutResult =
  | { ok: true; planCode: "guest" | "segna_plus" | "segna_x" }
  | { ok: false; reason: string; status: number };

/**
 * Synchronise un Checkout Session abonnement Stripe → entitlements (+ empreinte si demandée).
 */
export async function confirmSubscriptionCheckoutSession(params: {
  admin: any;
  userId: string;
  sessionId: string;
  fallbackPlan?: string | null;
  checkoutMode?: "sync" | "webhook";
}): Promise<ConfirmSubscriptionCheckoutResult> {
  const { admin, userId, sessionId, fallbackPlan, checkoutMode = "sync" } = params;

  const { secretKey } = getStripeConfig();
  const stripe = new Stripe(secretKey);
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

  const expectedUserId =
    session.metadata?.user_id ??
    (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
  if (expectedUserId && expectedUserId !== userId) {
    return { ok: false, reason: "user_mismatch", status: 403 };
  }

  const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
  if (!stripeCustomerId) {
    return { ok: false, reason: "missing_customer", status: 400 };
  }

  await upsertBillingCustomer(admin, userId, stripeCustomerId, session.metadata ?? {});

  const subscription =
    typeof session.subscription === "string"
      ? await stripe.subscriptions.retrieve(session.subscription)
      : (session.subscription as Stripe.Subscription | null);

  if (!subscription?.id) {
    return { ok: false, reason: "missing_subscription", status: 400 };
  }

  await upsertSubscriptionAndEntitlements(admin, userId, stripeCustomerId, subscription);

  try {
    await createSegnaXSubscriptionBankHoldIfNeeded({
      stripe,
      session,
      subscription,
      userId,
      customerId: stripeCustomerId,
    });
  } catch (e) {
    console.error("[stripe] subscription bank hold", e);
  }

  const planFromMeta =
    (typeof subscription.metadata?.plan_code === "string" && subscription.metadata.plan_code) ||
    (typeof session.metadata?.plan_code === "string" && session.metadata.plan_code) ||
    null;
  const resolvedPlan = isPlanCode(planFromMeta)
    ? planFromMeta
    : isPlanCode(fallbackPlan)
      ? fallbackPlan
      : "segna_plus";

  trackServerEvent(
    "subscription_confirmed",
    { distinctId: userId, insertId: `subscription_confirmed:${sessionId}` },
    {
      plan_code: resolvedPlan,
      checkout_mode: checkoutMode,
      stripe_session_id: sessionId,
    },
  );
  await flushServerAnalytics();

  return { ok: true, planCode: resolvedPlan };
}
