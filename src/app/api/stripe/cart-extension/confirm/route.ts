import { NextResponse } from "next/server";
import Stripe from "stripe";

import { applyCartBorrowExtension } from "@/lib/cart/apply-cart-borrow-extension";
import { computeBorrowExtensionAmountCents } from "@/lib/cart/borrow-extension-pricing";
import { getStripeConfig } from "@/lib/social/stripe";
import { persistStripeCustomerDefaultPaymentMethodFromCheckout } from "@/lib/stripe/persist-customer-default-payment-method";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

/**
 * Confirmation post-Checkout prolongation (Bearer mobile / cookie).
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
      return NextResponse.json({ message: "Session Stripe invalide." }, { status: 403 });
    }

    if (session.metadata?.checkout_kind !== "cart_borrow_extension") {
      return NextResponse.json({ message: "Type de paiement invalide." }, { status: 400 });
    }

    const cartId = typeof session.metadata?.cart_id === "string" ? session.metadata.cart_id : "";
    if (!cartId) {
      return NextResponse.json({ message: "Commande manquante." }, { status: 400 });
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json({ message: "Paiement non confirmé." }, { status: 400 });
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
      return NextResponse.json({ message: "Métadonnées de prolongation invalides." }, { status: 400 });
    }

    try {
      await persistStripeCustomerDefaultPaymentMethodFromCheckout(stripe, session);
    } catch (e) {
      console.error("[stripe/cart-extension/confirm] persist default payment method", e);
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
      return NextResponse.json(
        { message: applyResult.reason ?? "Prolongation non appliquée.", code: applyResult.reason },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, cartId, extensionDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de confirmer la prolongation.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
