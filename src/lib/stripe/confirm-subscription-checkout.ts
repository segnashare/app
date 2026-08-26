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

function resolvePlanCode(params: {
  subscription: Stripe.Subscription;
  sessionPlan?: string | null;
  fallbackPlan?: string | null;
}): "guest" | "segna_plus" | "segna_x" {
  const planFromMeta =
    (typeof params.subscription.metadata?.plan_code === "string" && params.subscription.metadata.plan_code) ||
    (typeof params.sessionPlan === "string" && params.sessionPlan) ||
    null;
  if (isPlanCode(planFromMeta)) return planFromMeta;
  if (isPlanCode(params.fallbackPlan)) return params.fallbackPlan;
  return "segna_plus";
}

async function finalizeConfirmedSubscription(params: {
  admin: any;
  userId: string;
  stripe: Stripe;
  stripeCustomerId: string;
  subscription: Stripe.Subscription;
  session?: Stripe.Checkout.Session | null;
  fallbackPlan?: string | null;
  checkoutMode: "sync" | "webhook" | "payment_sheet";
  analyticsInsertId: string;
}): Promise<ConfirmSubscriptionCheckoutResult> {
  const {
    admin,
    userId,
    stripe,
    stripeCustomerId,
    subscription,
    session,
    fallbackPlan,
    checkoutMode,
    analyticsInsertId,
  } = params;

  if (
    checkoutMode === "payment_sheet" &&
    subscription.status !== "active" &&
    subscription.status !== "trialing"
  ) {
    return {
      ok: false,
      reason: "subscription_not_active",
      status: 402,
      detail: `Abonnement Stripe encore « ${subscription.status} ». Termine le paiement puis réessaie.`,
    };
  }

  await upsertBillingCustomer(admin, userId, stripeCustomerId, session?.metadata ?? subscription.metadata ?? {});

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
      session: session ?? null,
      subscription,
      userId,
      customerId: stripeCustomerId,
    });
  } catch (e) {
    // L’abonnement est déjà sync : ne pas faire échouer la confirmation pour l’empreinte.
    console.error("[stripe] subscription bank hold", e);
  }

  const resolvedPlan = resolvePlanCode({
    subscription,
    sessionPlan: typeof session?.metadata?.plan_code === "string" ? session.metadata.plan_code : null,
    fallbackPlan,
  });

  trackServerEvent(
    "subscription_confirmed",
    { distinctId: userId, insertId: analyticsInsertId },
    {
      plan_code: resolvedPlan,
      checkout_mode: checkoutMode,
      ...(session?.id ? { stripe_session_id: session.id } : {}),
      stripe_subscription_id: subscription.id,
    },
  );
  await flushServerAnalytics();

  return { ok: true, planCode: resolvedPlan };
}

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

  const subscription =
    typeof session.subscription === "string"
      ? await stripe.subscriptions.retrieve(session.subscription)
      : (session.subscription as Stripe.Subscription | null);

  if (!subscription?.id) {
    return { ok: false, reason: "missing_subscription", status: 400 };
  }

  return finalizeConfirmedSubscription({
    admin,
    userId,
    stripe,
    stripeCustomerId,
    subscription,
    session,
    fallbackPlan,
    checkoutMode,
    analyticsInsertId: `subscription_confirmed:${sessionId}`,
  });
}

/**
 * Synchronise un abonnement créé via Payment Sheet (pas de Checkout Session).
 */
export async function confirmSubscriptionById(params: {
  admin: any;
  userId: string;
  subscriptionId: string;
  fallbackPlan?: string | null;
}): Promise<ConfirmSubscriptionCheckoutResult> {
  const { admin, userId, subscriptionId, fallbackPlan } = params;

  const { secretKey } = getStripeConfig();
  const stripe = new Stripe(secretKey);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const expectedUserId =
    typeof subscription.metadata?.user_id === "string" ? subscription.metadata.user_id.trim() : "";
  if (expectedUserId && expectedUserId !== userId) {
    return {
      ok: false,
      reason: "user_mismatch",
      status: 403,
      detail:
        "Cet abonnement Stripe est lié à un autre compte Segna. Reconnecte-toi avec le bon compte, puis réessaie.",
    };
  }

  const stripeCustomerId = typeof subscription.customer === "string" ? subscription.customer : null;
  if (!stripeCustomerId) {
    return { ok: false, reason: "missing_customer", status: 400 };
  }

  return finalizeConfirmedSubscription({
    admin,
    userId,
    stripe,
    stripeCustomerId,
    subscription,
    session: null,
    fallbackPlan,
    checkoutMode: "payment_sheet",
    analyticsInsertId: `subscription_confirmed:sub:${subscriptionId}`,
  });
}
