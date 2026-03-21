import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeWebhookConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

async function resolveUserIdFromCustomer(admin: any, stripeCustomerId: string): Promise<string | null> {
  const { data: customerRow } = await admin
    .from("billing_customers")
    .select("user_id")
    .eq("provider_customer_id", stripeCustomerId)
    .maybeSingle();

  return (customerRow?.user_id as string | undefined) ?? null;
}

async function upsertBillingCustomer(admin: any, userId: string, stripeCustomerId: string, metadata?: Record<string, unknown>) {
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

async function upsertSubscriptionAndEntitlements(
  admin: any,
  userId: string,
  stripeCustomerId: string | null,
  subscription: Stripe.Subscription,
) {
  const planCode = await getMappedPlanCodeFromSubscription(admin, subscription);
  const entitlementPlan: PlanCode = subscription.status === "active" || subscription.status === "trialing" ? planCode : "guest";

  // Basil API: current_period_start/end moved from Subscription to SubscriptionItem
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
}

async function applyWalletCreditFromCheckout(admin: any, session: Stripe.Checkout.Session, userId: string): Promise<boolean> {
  const checkoutKind = session.metadata?.checkout_kind ?? null;
  if (checkoutKind !== "credits_purchase") return false;

  const creditsAmountRaw = Number(session.metadata?.credits_amount ?? 0);
  const creditsAmount = Number.isFinite(creditsAmountRaw) ? Math.trunc(creditsAmountRaw) : 0;
  if (creditsAmount <= 0) return false;

  const { error: creditRpcError } = await admin.rpc("wallet_credit_purchase", {
    p_user_id: userId,
    p_amount_points: creditsAmount,
    p_credit_kind: session.metadata?.credits_kind ?? "pods",
    p_provider: "stripe",
    p_checkout_session_id: session.id,
    p_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    p_idempotency_key: `stripe:credits_checkout:${session.id}`,
    p_metadata: {
      customer_id: typeof session.customer === "string" ? session.customer : null,
      webhook_event: "checkout.session.completed",
    },
  });
  if (creditRpcError) throw new Error(creditRpcError.message);

  return true;
}

async function processStripeEvent(admin: any, stripe: Stripe, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
      let userId =
        session.metadata?.user_id ??
        session.metadata?.supabase_user_id ??
        (typeof session.client_reference_id === "string" ? session.client_reference_id : null);

      if (!userId && stripeCustomerId) {
        userId = await resolveUserIdFromCustomer(admin, stripeCustomerId);
      }

      if (!stripeCustomerId || !userId) return "ignored";

      await upsertBillingCustomer(admin, userId, stripeCustomerId, session.metadata ?? {});

      await applyWalletCreditFromCheckout(admin, session, userId);

      if (typeof session.subscription === "string") {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await upsertSubscriptionAndEntitlements(admin, userId, stripeCustomerId, subscription);
      }

      return "processed";
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const stripeCustomerId = typeof subscription.customer === "string" ? subscription.customer : null;
      if (!stripeCustomerId) return "ignored";

      let userId = await resolveUserIdFromCustomer(admin, stripeCustomerId);
      if (!userId && subscription.metadata?.user_id) {
        userId = subscription.metadata.user_id;
      }
      if (!userId) return "ignored";

      await upsertBillingCustomer(admin, userId, stripeCustomerId, subscription.metadata ?? {});
      await upsertSubscriptionAndEntitlements(admin, userId, stripeCustomerId, subscription);
      return "processed";
    }

    default:
      return "ignored";
  }
}

export async function POST(request: Request) {
  try {
    const { secretKey, webhookSecret } = getStripeWebhookConfig();
    const stripe = new Stripe(secretKey);
    const admin = createSupabaseAdminClient() as any;

    const signature = (await headers()).get("stripe-signature");
    if (!signature) {
      return NextResponse.json({ message: "Missing Stripe signature." }, { status: 400 });
    }

    const payload = await request.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Stripe signature.";
      return NextResponse.json({ message }, { status: 400 });
    }

    const insertEventPayload = {
      provider: "stripe",
      provider_event_id: event.id,
      event_type: event.type,
      status: "received",
      payload: event as unknown as Record<string, unknown>,
    };

    const { error: eventInsertError } = await admin.from("billing_webhook_events").insert(insertEventPayload);
    if (eventInsertError && eventInsertError.code !== "23505") {
      return NextResponse.json({ message: eventInsertError.message }, { status: 500 });
    }

    if (eventInsertError?.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    try {
      const processingResult = await processStripeEvent(admin, stripe, event);

      await admin
        .from("billing_webhook_events")
        .update({
          status: processingResult,
          processed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("provider_event_id", event.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook processing failed.";
      await admin
        .from("billing_webhook_events")
        .update({
          status: "failed",
          error_message: message,
          processed_at: new Date().toISOString(),
        })
        .eq("provider_event_id", event.id);
      return NextResponse.json({ message }, { status: 500 });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Stripe webhook.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
