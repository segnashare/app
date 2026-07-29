import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  parseOrderCheckoutEconomicsFromStripeSession,
  parseOrderConfirmedItemCount,
  trackOrderConfirmedServer,
} from "@/lib/analytics/order-confirmed";
import { flushServerAnalytics } from "@/lib/analytics/track-server";
import { notifyCartOrderPaidAfterConfirmation } from "@/lib/notifications/checkout-notifications";
import { confirmCartPaidFromStripeSession } from "@/lib/stripe/cart-order-fulfillment";
import { checkoutSessionIsGuestPurchase } from "@/lib/stripe/guest-purchase-stripe-invoice";
import { persistStripeCustomerDefaultPaymentMethodFromCheckout } from "@/lib/stripe/persist-customer-default-payment-method";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

/**
 * Confirmation post-Checkout panier (Bearer website ou session app).
 * Body : `{ sessionId }`
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) {
      return NextResponse.json({ message: "session_id manquant." }, { status: 400 });
    }

    const { user, error: userError } = await resolveRequestUser(request);
    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const admin = createSupabaseAdminClient() as any;
    const { secretKey } = getStripeConfig();
    const stripe = new Stripe(secretKey);
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
