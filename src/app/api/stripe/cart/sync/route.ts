import { NextResponse } from "next/server";
import Stripe from "stripe";

import { confirmCartPaidFromStripeSession } from "@/lib/stripe/cart-order-fulfillment";
import {
  exchangeOrderSuccessUrl,
  parseOrderCheckoutEconomicsFromStripeSession,
  parseOrderConfirmedItemCount,
  trackOrderConfirmedServer,
} from "@/lib/analytics/order-confirmed";
import { flushServerAnalytics } from "@/lib/analytics/track-server";
import { persistStripeCustomerDefaultPaymentMethodFromCheckout } from "@/lib/stripe/persist-customer-default-payment-method";
import { notifyCartOrderPaidAfterConfirmation } from "@/lib/notifications/checkout-notifications";
import { checkoutSessionIsGuestPurchase } from "@/lib/stripe/guest-purchase-stripe-invoice";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Retour utilisateur après Checkout commande panier.
 * Débit wallet (part non couverte par le complément €) — idempotent avec le webhook.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=missing_session", url.origin));
  }

  try {
    const supabase = (await createSupabaseServerClient()) as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.redirect(new URL("/auth/login", url.origin));
    }

    const admin = createSupabaseAdminClient() as any;
    const { secretKey } = getStripeConfig();
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const expectedUserId =
      session.metadata?.user_id ?? (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
    if (expectedUserId && expectedUserId !== user.id) {
      return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=user_mismatch", url.origin));
    }

    if (session.metadata?.checkout_kind !== "cart_order") {
      return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=wrong_checkout_kind", url.origin));
    }

    if (session.payment_status !== "paid") {
      return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=payment_not_paid", url.origin));
    }

    const missingRaw = Number(session.metadata?.missing_exchange_mods ?? 0);
    const missing = Number.isFinite(missingRaw) ? Math.trunc(missingRaw) : 0;
    if (missing < 0) {
      return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=invalid_missing_credits", url.origin));
    }

    const devDetail = (msg: string) =>
      process.env.NODE_ENV === "development" ? `&detail=${encodeURIComponent(msg.slice(0, 400))}` : "";

    try {
      await persistStripeCustomerDefaultPaymentMethodFromCheckout(stripe, session);
    } catch (e) {
      console.error("[stripe/cart/sync] persist default payment method", e);
    }

    try {
      await confirmCartPaidFromStripeSession(admin, session, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "confirm_unknown";
      console.error("[stripe/cart/sync] confirm_cart_paid_from_stripe failed", msg);
      return NextResponse.redirect(
        new URL(`/cart/payment?checkout=error&reason=cart_confirm_failed${devDetail(msg)}`, url.origin),
      );
    }

    const cartIdForNotify = session.metadata?.cart_id?.trim();
    if (cartIdForNotify) {
      try {
        await notifyCartOrderPaidAfterConfirmation(admin, {
          userId: user.id,
          cartId: cartIdForNotify,
          skipMemberNotification: checkoutSessionIsGuestPurchase(session),
        });
      } catch (e) {
        console.error("[stripe/cart/sync] notifyCartOrderPaidAfterConfirmation", e);
      }
      trackOrderConfirmedServer(user.id, {
        cart_id: cartIdForNotify,
        checkout_mode: "stripe",
        used_included_order: session.metadata?.used_included_order === "true",
        item_count: parseOrderConfirmedItemCount(session.metadata ?? undefined),
        ...parseOrderCheckoutEconomicsFromStripeSession(session),
      });
      await flushServerAnalytics();
    }

    const successPath = cartIdForNotify
      ? exchangeOrderSuccessUrl(
          url.origin,
          cartIdForNotify,
          "stripe",
          parseOrderConfirmedItemCount(session.metadata ?? undefined),
        )
      : "/exchange?cart=success";
    return NextResponse.redirect(new URL(successPath, url.origin));
  } catch {
    return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=sync_failed", url.origin));
  }
}
