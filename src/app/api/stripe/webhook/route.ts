import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";

import { confirmCartPaidFromStripeSession } from "@/lib/stripe/cart-order-fulfillment";
import {
  trackOrderConfirmedServer,
  parseOrderConfirmedItemCount,
  parseOrderCheckoutEconomicsFromStripeSession,
} from "@/lib/analytics/order-confirmed";
import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
import { getStripeWebhookConfig } from "@/lib/social/stripe";
import { persistStripeCustomerDefaultPaymentMethodFromCheckoutSession } from "@/lib/stripe/persist-customer-default-payment-method";
import { upsertBillingCustomer, upsertSubscriptionAndEntitlements } from "@/lib/stripe/subscription-state";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  notifyCartOrderPaidAfterConfirmation,
  notifyWalletCreditsPurchased,
} from "@/lib/notifications/checkout-notifications";
import { notifySegnaXSubscriptionWelcomeIfApplicable } from "@/lib/notifications/subscription-notifications";
import { normalizeWalletCreditKind } from "@/lib/wallet/credit-kind";

async function resolveUserIdFromCustomer(admin: any, stripeCustomerId: string): Promise<string | null> {
  const { data: customerRow } = await admin
    .from("billing_customers")
    .select("user_id")
    .eq("provider_customer_id", stripeCustomerId)
    .maybeSingle();

  return (customerRow?.user_id as string | undefined) ?? null;
}

/** Complément panier payé en € : ne crédite plus le wallet (débit direct dans wallet_debit_cart_order_stripe). */
async function applyCartOrderWalletFromCheckout(_admin: unknown, _session: Stripe.Checkout.Session, _userId: string): Promise<boolean> {
  return false;
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
    p_credit_kind: normalizeWalletCreditKind(session.metadata?.credits_kind ?? undefined),
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

      try {
        await persistStripeCustomerDefaultPaymentMethodFromCheckoutSession(stripe, session);
      } catch (e) {
        console.error("[stripe/webhook] persist default payment method", e);
      }

      const creditsPurchaseApplied = await applyWalletCreditFromCheckout(admin, session, userId);
      await applyCartOrderWalletFromCheckout(admin, session, userId);
      const confirmResult = await confirmCartPaidFromStripeSession(admin, session, userId);

      if (session.metadata?.checkout_kind === "cart_order" || session.metadata?.checkout_kind === "cart_order_wallet_setup") {
        const cartId = session.metadata?.cart_id?.trim();
        if (cartId) {
          try {
            await notifyCartOrderPaidAfterConfirmation(admin, { userId, cartId });
          } catch (e) {
            console.error("[stripe/webhook] notifyCartOrderPaidAfterConfirmation", e);
          }
          if (!confirmResult.alreadyConfirmed) {
            trackOrderConfirmedServer(userId, {
              cart_id: cartId,
              checkout_mode: "webhook",
              used_included_order: session.metadata?.used_included_order === "true",
              item_count: parseOrderConfirmedItemCount(session.metadata ?? undefined),
              ...parseOrderCheckoutEconomicsFromStripeSession(session),
            });
          }
        }
      }

      if (creditsPurchaseApplied) {
        const creditsAmountRaw = Number(session.metadata?.credits_amount ?? 0);
        const creditsAmount = Number.isFinite(creditsAmountRaw) ? Math.trunc(creditsAmountRaw) : 0;
        if (creditsAmount > 0) {
          try {
            await notifyWalletCreditsPurchased(admin, {
              userId,
              stripeCheckoutSessionId: session.id,
              creditsAmount,
            });
          } catch (e) {
            console.error("[stripe/webhook] notifyWalletCreditsPurchased", e);
          }
        }
      }

      if (typeof session.subscription === "string") {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await upsertSubscriptionAndEntitlements(admin, userId, stripeCustomerId, subscription);
        const planCode =
          (typeof session.metadata?.plan_code === "string" && session.metadata.plan_code) ||
          (typeof subscription.metadata?.plan_code === "string" && subscription.metadata.plan_code) ||
          "segna_x";
        trackServerEvent(
          "subscription_confirmed",
          { distinctId: userId, insertId: `subscription_confirmed:${session.id}` },
          {
            plan_code: planCode,
            checkout_mode: "webhook",
            stripe_session_id: session.id,
          },
        );
        try {
          await notifySegnaXSubscriptionWelcomeIfApplicable(admin, userId, subscription);
        } catch (e) {
          console.error("[stripe/webhook] notifySegnaXSubscriptionWelcomeIfApplicable (checkout.session)", e);
        }
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
      try {
        await notifySegnaXSubscriptionWelcomeIfApplicable(admin, userId, subscription);
      } catch (e) {
        console.error("[stripe/webhook] notifySegnaXSubscriptionWelcomeIfApplicable (subscription event)", e);
      }
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
      await flushServerAnalytics();
      return NextResponse.json({ message }, { status: 500 });
    }

    await flushServerAnalytics();
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Stripe webhook.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
