import { NextResponse } from "next/server";
import Stripe from "stripe";

import { applyCartBuyout } from "@/lib/cart/apply-cart-buyout";
import { computeRentalBuyoutEuroCents } from "@/lib/billing/rental-buyout-pricing";
import { persistStripeCustomerDefaultPaymentMethodFromCheckout } from "@/lib/stripe/persist-customer-default-payment-method";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function parseIdList(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    // ignore
  }
  return [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.redirect(new URL("/exchange?buyout=error&reason=missing_session", url.origin));
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
      return NextResponse.redirect(new URL("/exchange?buyout=error&reason=user_mismatch", url.origin));
    }

    if (session.metadata?.checkout_kind !== "cart_rental_buyout") {
      return NextResponse.redirect(new URL("/exchange?buyout=error&reason=wrong_checkout_kind", url.origin));
    }

    const cartId = typeof session.metadata?.cart_id === "string" ? session.metadata.cart_id : "";
    if (!cartId) {
      return NextResponse.redirect(new URL("/exchange?buyout=error&reason=missing_cart", url.origin));
    }

    if (session.payment_status !== "paid") {
      return NextResponse.redirect(
        new URL(`/commande/${cartId}/acheter?buyout=error&reason=payment_not_paid`, url.origin),
      );
    }

    const amountCentsMeta = Math.trunc(Number(session.metadata?.amount_cents ?? 0));
    const retailCents = Math.trunc(Number(session.metadata?.retail_cents ?? 0));
    const discountPercent = Math.trunc(Number(session.metadata?.discount_percent ?? 0));
    const totalPoints = Math.round(retailCents / 100);
    const amountCentsExpected = computeRentalBuyoutEuroCents(totalPoints, discountPercent);
    const cartItemIds = parseIdList(session.metadata?.cart_item_ids);
    const itemIds = parseIdList(session.metadata?.item_ids);

    if (
      amountCentsMeta <= 0 ||
      retailCents <= 0 ||
      amountCentsMeta !== amountCentsExpected ||
      cartItemIds.length === 0 ||
      itemIds.length !== cartItemIds.length
    ) {
      return NextResponse.redirect(
        new URL(`/commande/${cartId}/acheter?buyout=error&reason=invalid_metadata`, url.origin),
      );
    }

    try {
      await persistStripeCustomerDefaultPaymentMethodFromCheckout(stripe, session);
    } catch (e) {
      console.error("[stripe/cart-buyout/sync] persist default payment method", e);
    }

    const applyResult = await applyCartBuyout(admin, {
      userId: user.id,
      cartId,
      amountCents: amountCentsMeta,
      discountPercent,
      retailCents,
      cartItemIds,
      itemIds,
      checkoutSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    });

    if (!applyResult.applied) {
      const reason = applyResult.reason ?? "not_applied";
      console.error("[stripe/cart-buyout/sync] apply failed", { reason, cartId, sessionId: session.id });
      return NextResponse.redirect(
        new URL(`/commande/${cartId}/acheter?buyout=error&reason=${encodeURIComponent(reason)}`, url.origin),
      );
    }

    const archived = applyResult.archived ? "&archived=1" : "";
    return NextResponse.redirect(
      new URL(`/exchange/emprunt/${cartId}?buyout=success${archived}`, url.origin),
    );
  } catch {
    return NextResponse.redirect(new URL("/exchange?buyout=error&reason=sync_failed", url.origin));
  }
}
