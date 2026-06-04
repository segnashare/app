import { NextResponse } from "next/server";
import Stripe from "stripe";

import { applyCartBorrowExtension } from "@/lib/cart/apply-cart-borrow-extension";
import { persistStripeCustomerDefaultPaymentMethodFromCheckout } from "@/lib/stripe/persist-customer-default-payment-method";
import { computeBorrowExtensionAmountCents } from "@/lib/cart/borrow-extension-pricing";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.redirect(new URL("/exchange?extension=error&reason=missing_session", url.origin));
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createSupabaseServerClient()) as any;
    const admin = createSupabaseAdminClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.redirect(new URL("/auth/login", url.origin));
    }

    const { secretKey } = getStripeConfig();
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const expectedUserId =
      session.metadata?.user_id ??
      (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
    if (expectedUserId && expectedUserId !== user.id) {
      return NextResponse.redirect(new URL("/exchange?extension=error&reason=user_mismatch", url.origin));
    }

    if (session.metadata?.checkout_kind !== "cart_borrow_extension") {
      return NextResponse.redirect(new URL("/exchange?extension=error&reason=wrong_checkout_kind", url.origin));
    }

    const cartId = typeof session.metadata?.cart_id === "string" ? session.metadata.cart_id : "";
    if (!cartId) {
      return NextResponse.redirect(new URL("/exchange?extension=error&reason=missing_cart", url.origin));
    }

    if (session.payment_status !== "paid") {
      return NextResponse.redirect(
        new URL(`/commande/${cartId}/prolonger?extension=error&reason=payment_not_paid`, url.origin),
      );
    }

    const extensionDays = Math.trunc(Number(session.metadata?.extension_days ?? 0));
    const creditsCharged = Math.trunc(Number(session.metadata?.credits_charged ?? 0));
    const amountCentsMeta = Math.trunc(Number(session.metadata?.amount_cents ?? 0));
    const amountCentsExpected = computeBorrowExtensionAmountCents(creditsCharged, extensionDays);

    if (
      extensionDays < 1 ||
      creditsCharged <= 0 ||
      amountCentsMeta <= 0 ||
      amountCentsMeta !== amountCentsExpected
    ) {
      return NextResponse.redirect(
        new URL(`/commande/${cartId}/prolonger?extension=error&reason=invalid_metadata`, url.origin),
      );
    }

    try {
      await persistStripeCustomerDefaultPaymentMethodFromCheckout(stripe, session);
    } catch (e) {
      console.error("[stripe/cart-extension/sync] persist default payment method", e);
    }

    let cartItemIds: string[] = [];
    try {
      const parsed = JSON.parse(session.metadata?.cart_item_ids ?? "[]") as unknown;
      if (Array.isArray(parsed)) {
        cartItemIds = parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      cartItemIds = [];
    }

    const applyResult = await applyCartBorrowExtension(admin, {
      userId: user.id,
      cartId,
      extensionDays,
      creditsCharged,
      amountCents: amountCentsMeta,
      cartItemIds,
      checkoutSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    });

    if (!applyResult.applied) {
      const reason = applyResult.reason ?? "not_applied";
      console.error("[stripe/cart-extension/sync] apply failed", { reason, cartId, sessionId: session.id });
      return NextResponse.redirect(
        new URL(`/commande/${cartId}/prolonger?extension=error&reason=${encodeURIComponent(reason)}`, url.origin),
      );
    }

    return NextResponse.redirect(
      new URL(`/commande/${cartId}/prolonger?extension=success&days=${extensionDays}`, url.origin),
    );
  } catch {
    return NextResponse.redirect(new URL("/exchange?extension=error&reason=sync_failed", url.origin));
  }
}
