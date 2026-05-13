import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  confirmCartPaidFromStripeSession,
  debitCartExchangeWalletFromStripeSession,
} from "@/lib/stripe/cart-order-fulfillment";
import { notifyCartOrderPaidAfterConfirmation } from "@/lib/notifications/checkout-notifications";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { walletCreditKindForBillingSubscription } from "@/lib/wallet/credit-kind";

/**
 * Retour utilisateur après Checkout commande panier.
 * Recrédite le wallet (complément) avec la même clé d’idempotence que le webhook — au cas où le webhook arrive après la redirection.
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
    if (missing > 0) {
      const creditKind = walletCreditKindForBillingSubscription(null, null);
      const { error: rpcError } = await admin.rpc("wallet_credit_purchase", {
        p_user_id: user.id,
        p_amount_points: missing,
        p_credit_kind: creditKind,
        p_provider: "stripe",
        p_checkout_session_id: session.id,
        p_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
        p_idempotency_key: `stripe:cart_order_wallet:${session.id}`,
        p_metadata: {
          source: "cart_sync_route",
        },
      });
      if (rpcError) {
        return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=wallet_sync_failed", url.origin));
      }
    }

    const devDetail = (msg: string) =>
      process.env.NODE_ENV === "development" ? `&detail=${encodeURIComponent(msg.slice(0, 400))}` : "";

    try {
      await debitCartExchangeWalletFromStripeSession(admin, session, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "debit_unknown";
      console.error("[stripe/cart/sync] wallet_debit_cart_order_stripe failed", msg);
      return NextResponse.redirect(
        new URL(`/cart/payment?checkout=error&reason=cart_debit_failed${devDetail(msg)}`, url.origin),
      );
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
        await notifyCartOrderPaidAfterConfirmation(admin, { userId: user.id, cartId: cartIdForNotify });
      } catch (e) {
        console.error("[stripe/cart/sync] notifyCartOrderPaidAfterConfirmation", e);
      }
    }

    return NextResponse.redirect(new URL("/exchange?cart=success", url.origin));
  } catch {
    return NextResponse.redirect(new URL("/cart/payment?checkout=error&reason=sync_failed", url.origin));
  }
}
