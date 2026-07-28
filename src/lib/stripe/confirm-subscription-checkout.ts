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
  | { ok: false; reason: string; status: number; detail?: string };

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
    return {
      ok: false,
      reason: "user_mismatch",
      status: 403,
      detail:
        "Ce paiement Stripe est lié à un autre compte Segna. Reconnecte-toi avec l’email utilisé lors du checkout, puis réessaie.",
    };
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

  try {
    await upsertSubscriptionAndEntitlements(admin, userId, stripeCustomerId, subscription);
  } catch (e) {
    console.error("[stripe] upsert subscription/entitlements", e);
    const message = e instanceof Error ? e.message : "subscription_upsert_failed";
    return { ok: false, reason: "subscription_upsert_failed", status: 500, detail: message };
  }

  try {
    await createSegnaXSubscriptionBankHoldIfNeeded({
      stripe,
      session,
      subscription,
      userId,
      customerId: stripeCustomerId,
    });
  } catch (e) {
    // L’abonnement est déjà sync : ne pas faire échouer la page succès pour l’empreinte.
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
