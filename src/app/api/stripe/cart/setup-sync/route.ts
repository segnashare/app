import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  confirmCartPaidFromStripeSession,
  debitCartExchangeWalletFromStripeSession,
} from "@/lib/stripe/cart-order-fulfillment";
import {
  exchangeOrderSuccessUrl,
  parseOrderCheckoutEconomicsFromMetadata,
  parseOrderConfirmedItemCount,
  trackOrderConfirmedServer,
} from "@/lib/analytics/order-confirmed";
import { flushServerAnalytics } from "@/lib/analytics/track-server";
import { persistStripeCustomerDefaultPaymentMethodFromSetupSession } from "@/lib/stripe/persist-customer-default-payment-method";
import { notifyCartOrderPaidAfterConfirmation } from "@/lib/notifications/checkout-notifications";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Retour utilisateur après Checkout Setup (panier 0 €, enregistrement carte).
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

    if (session.metadata?.checkout_kind !== "cart_order_wallet_setup") {
      return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=wrong_checkout_kind", url.origin));
    }

    if (session.mode !== "setup" || session.status !== "complete") {
      return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=setup_not_complete", url.origin));
    }

    const devDetail = (msg: string) =>
      process.env.NODE_ENV === "development" ? `&detail=${encodeURIComponent(msg.slice(0, 400))}` : "";

    try {
      await persistStripeCustomerDefaultPaymentMethodFromSetupSession(stripe, session);
    } catch (e) {
      console.error("[stripe/cart/setup-sync] persist default payment method", e);
    }

    try {
      await debitCartExchangeWalletFromStripeSession(admin, session, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "debit_unknown";
      console.error("[stripe/cart/setup-sync] wallet_debit_cart_order_stripe failed", msg);
      return NextResponse.redirect(
        new URL(`/cart/payment?checkout=error&reason=cart_debit_failed${devDetail(msg)}`, url.origin),
      );
    }

    try {
      await confirmCartPaidFromStripeSession(admin, session, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "confirm_unknown";
      console.error("[stripe/cart/setup-sync] confirm_cart_paid_from_stripe failed", msg);
      return NextResponse.redirect(
        new URL(`/cart/payment?checkout=error&reason=cart_confirm_failed${devDetail(msg)}`, url.origin),
      );
    }

    const cartIdForNotify = session.metadata?.cart_id?.trim();
    if (cartIdForNotify) {
      try {
        await notifyCartOrderPaidAfterConfirmation(admin, { userId: user.id, cartId: cartIdForNotify });
      } catch (e) {
        console.error("[stripe/cart/setup-sync] notifyCartOrderPaidAfterConfirmation", e);
      }
      trackOrderConfirmedServer(user.id, {
        cart_id: cartIdForNotify,
        checkout_mode: "wallet_setup",
        used_included_order: session.metadata?.used_included_order === "true",
        item_count: parseOrderConfirmedItemCount(session.metadata ?? undefined),
        ...parseOrderCheckoutEconomicsFromMetadata(session.metadata ?? undefined),
      });
      await flushServerAnalytics();
    }

    const successPath = cartIdForNotify
      ? exchangeOrderSuccessUrl(
          url.origin,
          cartIdForNotify,
          "wallet_setup",
          parseOrderConfirmedItemCount(session.metadata ?? undefined),
        )
      : "/exchange?cart=success";
    return NextResponse.redirect(new URL(successPath, url.origin));
  } catch {
    return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=sync_failed", url.origin));
  }
}
