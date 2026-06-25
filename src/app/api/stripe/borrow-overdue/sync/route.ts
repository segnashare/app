import { NextResponse } from "next/server";
import Stripe from "stripe";

import { notifyBorrowOverdueAfterStripeCharge } from "@/lib/cart/notify-borrow-overdue-after-stripe-charge";
import { applyBorrowOverdueCheckoutSession } from "@/lib/stripe/borrow-overdue-checkout";
import { persistStripeCustomerDefaultPaymentMethodFromCheckout } from "@/lib/stripe/persist-customer-default-payment-method";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.redirect(new URL("/exchange?overdue=error&reason=missing_session", url.origin));
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createSupabaseServerClient()) as any;
    const admin = createSupabaseAdminClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.redirect(new URL("/auth/login", url.origin));
    }

    const stripe = new Stripe(getStripeConfig().secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const expectedUserId =
      session.metadata?.user_id ??
      (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
    if (expectedUserId && expectedUserId !== user.id) {
      return NextResponse.redirect(new URL("/exchange?overdue=error&reason=user_mismatch", url.origin));
    }

    const cartId = typeof session.metadata?.cart_id === "string" ? session.metadata.cart_id : "";
    if (!cartId) {
      return NextResponse.redirect(new URL("/exchange?overdue=error&reason=missing_cart", url.origin));
    }

    if (session.payment_status !== "paid") {
      return NextResponse.redirect(
        new URL(`/exchange/emprunt/${cartId}/regulariser?checkout=error&reason=payment_not_paid`, url.origin),
      );
    }

    try {
      await persistStripeCustomerDefaultPaymentMethodFromCheckout(stripe, session);
    } catch (e) {
      console.error("[stripe/borrow-overdue/sync] persist default payment method", e);
    }

    const applied = await applyBorrowOverdueCheckoutSession(admin, session);
    if (!applied.applied || !applied.paymentIntentId) {
      return NextResponse.redirect(
        new URL(`/exchange/emprunt/${cartId}/regulariser?checkout=error&reason=not_applied`, url.origin),
      );
    }

    try {
      await notifyBorrowOverdueAfterStripeCharge(admin, {
        userId: user.id,
        cartId,
        paymentIntentId: applied.paymentIntentId,
      });
    } catch (e) {
      console.error("[stripe/borrow-overdue/sync] notify after charge", e);
    }

    return NextResponse.redirect(
      new URL(`/exchange/emprunt/${cartId}/regulariser?checkout=success`, url.origin),
    );
  } catch {
    return NextResponse.redirect(new URL("/exchange?overdue=error&reason=sync_failed", url.origin));
  }
}
