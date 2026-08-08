import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  parseOrderCheckoutEconomicsFromMetadata,
  parseOrderCheckoutEconomicsFromStripeSession,
  parseOrderConfirmedItemCount,
  trackOrderConfirmedServer,
} from "@/lib/analytics/order-confirmed";
import { flushServerAnalytics } from "@/lib/analytics/track-server";
import { notifyCartOrderPaidAfterConfirmation } from "@/lib/notifications/checkout-notifications";
import {
  confirmCartPaidFromStripePaymentIntent,
  confirmCartPaidFromStripeSession,
  confirmCartPaidFromStripeSetupIntent,
} from "@/lib/stripe/cart-order-fulfillment";
import { checkoutSessionIsGuestPurchase } from "@/lib/stripe/guest-purchase-stripe-invoice";
import {
  persistStripeCustomerDefaultPaymentMethodFromCheckout,
  persistStripeCustomerDefaultPaymentMethodFromPaymentIntent,
  persistStripeCustomerDefaultPaymentMethodFromSetupIntent,
} from "@/lib/stripe/persist-customer-default-payment-method";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

/**
 * Confirmation post-paiement panier (Bearer website ou session app).
 * Body : `{ sessionId }` | `{ paymentIntentId }` | `{ setupIntentId }` (Payment Sheet).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
      paymentIntentId?: unknown;
      setupIntentId?: unknown;
    } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    const paymentIntentId =
      typeof body?.paymentIntentId === "string" ? body.paymentIntentId.trim() : "";
    const setupIntentId =
      typeof body?.setupIntentId === "string" ? body.setupIntentId.trim() : "";

    if (!sessionId && !paymentIntentId && !setupIntentId) {
      return NextResponse.json(
        { message: "session_id, payment_intent_id ou setup_intent_id manquant." },
        { status: 400 },
      );
    }

    const { user, error: userError } = await resolveRequestUser(request);
    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const admin = createSupabaseAdminClient() as any;
    const { secretKey } = getStripeConfig();
    const stripe = new Stripe(secretKey);

    if (setupIntentId) {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      const expectedUserId = setupIntent.metadata?.user_id ?? null;
      if (expectedUserId && expectedUserId !== user.id) {
        return NextResponse.json({ message: "user_mismatch", code: "user_mismatch" }, { status: 403 });
      }
      if (setupIntent.metadata?.checkout_kind !== "cart_order_wallet_setup") {
        return NextResponse.json({ message: "Checkout invalide." }, { status: 400 });
      }
      if (setupIntent.status !== "succeeded") {
        return NextResponse.json({ message: "Enregistrement carte non confirmé." }, { status: 400 });
      }

      try {
        await persistStripeCustomerDefaultPaymentMethodFromSetupIntent(stripe, setupIntent);
      } catch (e) {
        console.error("[stripe/cart/confirm] persist default PM from SI", e);
      }

      try {
        await confirmCartPaidFromStripeSetupIntent(admin, setupIntent, user.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "confirm_unknown";
        console.error("[stripe/cart/confirm] confirm SI failed", msg);
        return NextResponse.json({ message: msg }, { status: 500 });
      }

      const cartId = setupIntent.metadata?.cart_id?.trim() || null;
      if (cartId) {
        try {
          await notifyCartOrderPaidAfterConfirmation(admin, {
            userId: user.id,
            cartId,
            skipMemberNotification: setupIntent.metadata?.purchase_mode === "true",
          });
        } catch (e) {
          console.error("[stripe/cart/confirm] notify", e);
        }
        trackOrderConfirmedServer(user.id, {
          cart_id: cartId,
          checkout_mode: "wallet_setup",
          used_included_order: setupIntent.metadata?.used_included_order === "true",
          item_count: parseOrderConfirmedItemCount(setupIntent.metadata ?? undefined),
          ...parseOrderCheckoutEconomicsFromMetadata(setupIntent.metadata ?? undefined),
        });
        await flushServerAnalytics();
      }

      return NextResponse.json({ ok: true, cartId, setupIntentId });
    }

    if (paymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const expectedUserId = paymentIntent.metadata?.user_id ?? null;
      if (expectedUserId && expectedUserId !== user.id) {
        return NextResponse.json({ message: "user_mismatch", code: "user_mismatch" }, { status: 403 });
      }
      if (paymentIntent.metadata?.checkout_kind !== "cart_order") {
        return NextResponse.json({ message: "Checkout invalide." }, { status: 400 });
      }
      if (paymentIntent.status !== "succeeded") {
        return NextResponse.json({ message: "Paiement non confirmé." }, { status: 400 });
      }

      try {
        await persistStripeCustomerDefaultPaymentMethodFromPaymentIntent(stripe, paymentIntent);
      } catch (e) {
        console.error("[stripe/cart/confirm] persist default PM from PI", e);
      }

      try {
        await confirmCartPaidFromStripePaymentIntent(admin, paymentIntent, user.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "confirm_unknown";
        console.error("[stripe/cart/confirm] confirm PI failed", msg);
        return NextResponse.json({ message: msg }, { status: 500 });
      }

      const cartId = paymentIntent.metadata?.cart_id?.trim() || null;
      if (cartId) {
        try {
          await notifyCartOrderPaidAfterConfirmation(admin, {
            userId: user.id,
            cartId,
            skipMemberNotification: paymentIntent.metadata?.purchase_mode === "true",
          });
        } catch (e) {
          console.error("[stripe/cart/confirm] notify", e);
        }
        trackOrderConfirmedServer(user.id, {
          cart_id: cartId,
          checkout_mode: "stripe_payment_sheet",
          used_included_order: paymentIntent.metadata?.used_included_order === "true",
          item_count: parseOrderConfirmedItemCount(paymentIntent.metadata ?? undefined),
          ...parseOrderCheckoutEconomicsFromMetadata(paymentIntent.metadata ?? undefined),
        });
        await flushServerAnalytics();
      }

      return NextResponse.json({ ok: true, cartId, paymentIntentId });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const expectedUserId =
      session.metadata?.user_id ??
      (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
    if (expectedUserId && expectedUserId !== user.id) {
      return NextResponse.json({ message: "user_mismatch", code: "user_mismatch" }, { status: 403 });
    }

    if (session.metadata?.checkout_kind !== "cart_order") {
      return NextResponse.json({ message: "Checkout invalide." }, { status: 400 });
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json({ message: "Paiement non confirmé." }, { status: 400 });
    }

    try {
      await persistStripeCustomerDefaultPaymentMethodFromCheckout(stripe, session);
    } catch (e) {
      console.error("[stripe/cart/confirm] persist default payment method", e);
    }

    try {
      await confirmCartPaidFromStripeSession(admin, session, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "confirm_unknown";
      console.error("[stripe/cart/confirm] confirm failed", msg);
      return NextResponse.json({ message: msg }, { status: 500 });
    }

    const cartId = session.metadata?.cart_id?.trim() || null;
    if (cartId) {
      try {
        await notifyCartOrderPaidAfterConfirmation(admin, {
          userId: user.id,
          cartId,
          skipMemberNotification: checkoutSessionIsGuestPurchase(session),
        });
      } catch (e) {
        console.error("[stripe/cart/confirm] notify", e);
      }
      trackOrderConfirmedServer(user.id, {
        cart_id: cartId,
        checkout_mode: "stripe",
        used_included_order: session.metadata?.used_included_order === "true",
        item_count: parseOrderConfirmedItemCount(session.metadata ?? undefined),
        ...parseOrderCheckoutEconomicsFromStripeSession(session),
      });
      await flushServerAnalytics();
    }

    return NextResponse.json({ ok: true, cartId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de confirmer la commande.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
