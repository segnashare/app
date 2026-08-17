import { NextResponse } from "next/server";
import Stripe from "stripe";

import { applyCartBuyout } from "@/lib/cart/apply-cart-buyout";
import {
  computeRentalBuyoutEuroCents,
} from "@/lib/billing/rental-buyout-pricing";
import { getStripeConfig } from "@/lib/social/stripe";
import {
  persistStripeCustomerDefaultPaymentMethodFromCheckout,
  persistStripeCustomerDefaultPaymentMethodFromPaymentIntent,
} from "@/lib/stripe/persist-customer-default-payment-method";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

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

function parseBuyoutMeta(meta: Stripe.Metadata | null | undefined): {
  cartId: string;
  amountCentsMeta: number;
  retailCents: number;
  discountPercent: number;
  amountCentsExpected: number;
  cartItemIds: string[];
  itemIds: string[];
  valid: boolean;
} {
  const cartId = typeof meta?.cart_id === "string" ? meta.cart_id : "";
  const amountCentsMeta = Math.trunc(Number(meta?.amount_cents ?? 0));
  const retailCents = Math.trunc(Number(meta?.retail_cents ?? 0));
  const discountPercent = Math.trunc(Number(meta?.discount_percent ?? 0));
  const cartItemIds = parseIdList(meta?.cart_item_ids);
  const itemIds = parseIdList(meta?.item_ids);
  /** Reconstitution points depuis retail (1 pt = 100 cts). */
  const totalPoints = Math.round(retailCents / 100);
  const amountCentsExpected = computeRentalBuyoutEuroCents(totalPoints, discountPercent);
  const valid =
    Boolean(cartId) &&
    amountCentsMeta > 0 &&
    retailCents > 0 &&
    discountPercent >= 0 &&
    discountPercent <= 100 &&
    amountCentsMeta === amountCentsExpected &&
    cartItemIds.length > 0 &&
    itemIds.length === cartItemIds.length;
  return {
    cartId,
    amountCentsMeta,
    retailCents,
    discountPercent,
    amountCentsExpected,
    cartItemIds,
    itemIds,
    valid,
  };
}

/**
 * Confirmation post-paiement buyout (Bearer mobile / cookie).
 * Body : `{ sessionId }` (Checkout) | `{ paymentIntentId }` (Payment Sheet).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
      paymentIntentId?: unknown;
    } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    const paymentIntentId =
      typeof body?.paymentIntentId === "string" ? body.paymentIntentId.trim() : "";

    if (!sessionId && !paymentIntentId) {
      return NextResponse.json(
        { message: "session_id ou payment_intent_id manquant." },
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

    if (paymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const expectedUserId = paymentIntent.metadata?.user_id ?? null;
      if (expectedUserId && expectedUserId !== user.id) {
        return NextResponse.json({ message: "Session Stripe invalide." }, { status: 403 });
      }
      if (paymentIntent.metadata?.checkout_kind !== "cart_rental_buyout") {
        return NextResponse.json({ message: "Type de paiement invalide." }, { status: 400 });
      }
      if (paymentIntent.status !== "succeeded") {
        return NextResponse.json({ message: "Paiement non confirmé." }, { status: 400 });
      }

      const parsed = parseBuyoutMeta(paymentIntent.metadata);
      if (!parsed.valid) {
        return NextResponse.json({ message: "Métadonnées d’achat invalides." }, { status: 400 });
      }

      try {
        await persistStripeCustomerDefaultPaymentMethodFromPaymentIntent(stripe, paymentIntent);
      } catch (e) {
        console.error("[stripe/cart-buyout/confirm] persist default PM from PI", e);
      }

      const applyResult = await applyCartBuyout(admin, {
        userId: user.id,
        cartId: parsed.cartId,
        amountCents: parsed.amountCentsMeta,
        discountPercent: parsed.discountPercent,
        retailCents: parsed.retailCents,
        cartItemIds: parsed.cartItemIds,
        itemIds: parsed.itemIds,
        checkoutSessionId: paymentIntent.id,
        paymentIntentId: paymentIntent.id,
      });

      if (!applyResult.applied) {
        return NextResponse.json(
          { message: applyResult.reason ?? "Achat non appliqué.", code: applyResult.reason },
          { status: 409 },
        );
      }

      return NextResponse.json({
        ok: true,
        cartId: parsed.cartId,
        archived: Boolean(applyResult.archived),
        paymentIntentId: paymentIntent.id,
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const expectedUserId =
      session.metadata?.user_id ??
      (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
    if (expectedUserId && expectedUserId !== user.id) {
      return NextResponse.json({ message: "Session Stripe invalide." }, { status: 403 });
    }

    if (session.metadata?.checkout_kind !== "cart_rental_buyout") {
      return NextResponse.json({ message: "Type de paiement invalide." }, { status: 400 });
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json({ message: "Paiement non confirmé." }, { status: 400 });
    }

    const parsed = parseBuyoutMeta(session.metadata);
    if (!parsed.valid) {
      return NextResponse.json({ message: "Métadonnées d’achat invalides." }, { status: 400 });
    }

    try {
      await persistStripeCustomerDefaultPaymentMethodFromCheckout(stripe, session);
    } catch (e) {
      console.error("[stripe/cart-buyout/confirm] persist default PM from session", e);
    }

    const applyResult = await applyCartBuyout(admin, {
      userId: user.id,
      cartId: parsed.cartId,
      amountCents: parsed.amountCentsMeta,
      discountPercent: parsed.discountPercent,
      retailCents: parsed.retailCents,
      cartItemIds: parsed.cartItemIds,
      itemIds: parsed.itemIds,
      checkoutSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    });

    if (!applyResult.applied) {
      return NextResponse.json(
        { message: applyResult.reason ?? "Achat non appliqué.", code: applyResult.reason },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      cartId: parsed.cartId,
      archived: Boolean(applyResult.archived),
      sessionId: session.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Confirmation impossible.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
