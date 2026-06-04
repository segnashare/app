import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  BORROW_EXTENSION_MAX_DAYS,
  BORROW_EXTENSION_MIN_DAYS,
  computeBorrowExtensionAmountCents,
  computeBorrowExtensionCreditsForCart,
} from "@/lib/cart/borrow-extension-pricing";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ message: "Corps de requête invalide." }, { status: 400 });
    }

    const cartId = typeof body.cartId === "string" ? body.cartId.trim() : "";
    if (!CART_ID_RE.test(cartId)) {
      return NextResponse.json({ message: "Panier invalide." }, { status: 400 });
    }

    const extensionDaysRaw = Number(body.extensionDays);
    const extensionDays = Number.isFinite(extensionDaysRaw) ? Math.trunc(extensionDaysRaw) : 0;
    if (extensionDays < BORROW_EXTENSION_MIN_DAYS || extensionDays > BORROW_EXTENSION_MAX_DAYS) {
      return NextResponse.json(
        { message: `Choisis entre ${BORROW_EXTENSION_MIN_DAYS} et ${BORROW_EXTENSION_MAX_DAYS} jours.` },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createSupabaseServerClient()) as any;
    const admin = createSupabaseAdminClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const userId = user.id as string;
    const membershipLabel = await resolveMembershipLabel(supabase, userId);
    const detail = await fetchMemberCartOrderDetail(
      supabase,
      userId,
      cartId,
      walletCreditKindForMembership(membershipLabel),
    );
    if (!detail) {
      return NextResponse.json({ message: "Commande introuvable." }, { status: 404 });
    }

    const shipSt = detail.shipment?.status?.toLowerCase() ?? "";
    if (shipSt !== "delivered") {
      return NextResponse.json({ message: "La prolongation est disponible après la livraison." }, { status: 400 });
    }

    if (detail.lines.length === 0) {
      return NextResponse.json({ message: "Panier vide." }, { status: 400 });
    }

    const cartItemIds = detail.lines.map((l) => l.id);
    const creditsTotal = computeBorrowExtensionCreditsForCart(detail.lines);
    if (creditsTotal <= 0) {
      return NextResponse.json({ message: "Aucun crédit à facturer pour ce panier." }, { status: 400 });
    }

    const amountCents = computeBorrowExtensionAmountCents(creditsTotal, extensionDays);
    if (amountCents <= 0) {
      return NextResponse.json({ message: "Montant invalide." }, { status: 400 });
    }

    const config = getStripeConfig();
    const stripe = new Stripe(config.secretKey);

    const { data: billingCustomerRow } = await admin
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("provider", "stripe")
      .eq("user_id", userId)
      .maybeSingle();

    let stripeCustomerId = billingCustomerRow?.provider_customer_id ?? null;
    if (!stripeCustomerId) {
      const createdCustomer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: userId },
      });
      stripeCustomerId = createdCustomer.id;
      await admin.from("billing_customers").upsert(
        {
          user_id: userId,
          provider: "stripe",
          provider_customer_id: stripeCustomerId,
          metadata: { source: "cart_extension_checkout" },
        },
        { onConflict: "user_id" },
      );
    }

    const successUrl = `${config.returnUrlBase}/api/stripe/cart-extension/sync?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.returnUrlBase}/commande/${cartId}/prolonger?extension=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      payment_intent_data: {
        setup_future_usage: "off_session",
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: amountCents,
            product_data: {
              name: `Prolongation location (${extensionDays} jour${extensionDays > 1 ? "s" : ""})`,
              description: `${creditsTotal} crédit${creditsTotal > 1 ? "s" : ""} · ${extensionDays} jour${extensionDays > 1 ? "s" : ""} · commande ${detail.orderNumberCompact}`,
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: {
        checkout_kind: "cart_borrow_extension",
        user_id: userId,
        cart_id: cartId,
        extension_days: String(extensionDays),
        credits_charged: String(creditsTotal),
        amount_cents: String(amountCents),
        cart_item_ids: JSON.stringify(cartItemIds),
      },
    });

    if (!session.url) {
      return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL de paiement." }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer le paiement.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
