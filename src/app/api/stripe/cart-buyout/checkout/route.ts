import { NextResponse } from "next/server";
import Stripe from "stripe";

import { fetchPurchaseDiscountPercentForMembership } from "@/lib/billing/fetch-purchase-discount-percent";
import {
  computeRentalBuyoutEuroCents,
  computeRentalBuyoutRetailEuroCents,
  resolveRentalBuyoutDiscountPercent,
} from "@/lib/billing/rental-buyout-pricing";
import {
  assertCartEligibleForBuyout,
  resolveSelectedBuyoutLines,
} from "@/lib/cart/rental-buyout-eligibility";
import { fetchMemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  ensureMemberReceiptAutoConfirmed,
  isMemberReceiptValidated,
  memberReceiptAnchorFromOrderShipment,
} from "@/lib/cart/member-receipt-validation";
import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseCartItemIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => CART_ID_RE.test(v));
}

function resolveMobileSuccessUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("segna://") || trimmed.includes("..")) return null;
  return trimmed.includes("{CHECKOUT_SESSION_ID}")
    ? trimmed
    : `${trimmed}${trimmed.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
}

function resolveCancelUrl(cancelRaw: string, returnUrlBase: string, cartId: string): string {
  if (cancelRaw.startsWith("segna://") && !cancelRaw.includes("..")) {
    return cancelRaw;
  }
  if (cancelRaw.startsWith(`/commande/${cartId}`) && !cancelRaw.includes("..")) {
    return `${returnUrlBase}${cancelRaw}`;
  }
  return `${returnUrlBase}/commande/${cartId}/acheter?buyout=cancelled`;
}

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

    const cartItemIds = parseCartItemIds(body.cartItemIds);
    if (cartItemIds.length === 0) {
      return NextResponse.json({ message: "Sélectionne au moins une pièce." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { user, error: userError, supabase } = (await resolveRequestUserClient(request)) as any;
    const admin = createSupabaseAdminClient() as any;

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

    const eligibility = assertCartEligibleForBuyout(detail);
    if (eligibility) {
      const messages: Record<string, string> = {
        purchase_order: "Cette commande est déjà un achat.",
        cart_not_confirmed: "Commande non confirmée.",
        not_delivered: "L’achat est disponible après la livraison.",
        return_started: "Le retour a déjà commencé — achat impossible.",
        no_buyable_lines: "Aucune pièce achetable sur cette location.",
      };
      return NextResponse.json(
        { message: messages[eligibility] ?? "Achat indisponible.", code: eligibility },
        { status: 400 },
      );
    }

    const receiptAnchor = memberReceiptAnchorFromOrderShipment(detail.shipment);
    await ensureMemberReceiptAutoConfirmed(supabase, {
      cartId,
      userId,
      memberReceiptConfirmedAt: detail.memberReceiptConfirmedAt,
      shipment: receiptAnchor,
    });
    if (!isMemberReceiptValidated(detail.memberReceiptConfirmedAt, receiptAnchor)) {
      return NextResponse.json(
        { message: "Valide d’abord la réception de ta box." },
        { status: 400 },
      );
    }

    const selected = resolveSelectedBuyoutLines(detail, cartItemIds);
    if (!selected.ok) {
      return NextResponse.json(
        { message: "Sélection invalide ou pièces indisponibles.", code: selected.reason },
        { status: 400 },
      );
    }

    const memberDiscountFromDb = await fetchPurchaseDiscountPercentForMembership(
      admin,
      membershipLabel,
    );
    const discountPercent = resolveRentalBuyoutDiscountPercent(
      membershipLabel,
      memberDiscountFromDb,
    );
    const totalPoints = selected.lines.reduce((s, l) => s + l.pricePoints, 0);
    const retailCents = computeRentalBuyoutRetailEuroCents(totalPoints);
    const amountCents = computeRentalBuyoutEuroCents(totalPoints, discountPercent);
    if (amountCents < 50) {
      return NextResponse.json({ message: "Montant trop faible pour Stripe." }, { status: 400 });
    }

    const itemIds = selected.lines.map((l) => l.itemId);
    const selectedCartItemIds = selected.lines.map((l) => l.id);

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
          metadata: { source: "cart_buyout_checkout" },
        },
        { onConflict: "user_id" },
      );
    }

    const pieceCount = selected.lines.length;
    const buyoutMetadata = {
      checkout_kind: "cart_rental_buyout",
      user_id: userId,
      cart_id: cartId,
      amount_cents: String(amountCents),
      retail_cents: String(retailCents),
      discount_percent: String(discountPercent),
      cart_item_ids: JSON.stringify(selectedCartItemIds),
      item_ids: JSON.stringify(itemIds),
    };

    const wantsPaymentSheet =
      body.paymentUi === "payment_sheet" || body.paymentUi === "native";

    if (wantsPaymentSheet) {
      if (!config.publishableKey) {
        return NextResponse.json(
          { message: "STRIPE_PUBLISHABLE_KEY manquante côté serveur." },
          { status: 500 },
        );
      }

      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: stripeCustomerId },
        { apiVersion: "2026-02-25.clover" },
      );

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "eur",
        customer: stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        setup_future_usage: "off_session",
        metadata: buyoutMetadata,
        description: `Achat fin de location (${pieceCount} pièce${pieceCount > 1 ? "s" : ""}) · commande ${detail.orderNumberCompact}`,
      });

      if (!paymentIntent.client_secret || !ephemeralKey.secret) {
        return NextResponse.json(
          { message: "Stripe n'a pas renvoyé les secrets Payment Sheet." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        paymentUi: "payment_sheet",
        paymentIntentId: paymentIntent.id,
        paymentIntentClientSecret: paymentIntent.client_secret,
        customerId: stripeCustomerId,
        customerEphemeralKeySecret: ephemeralKey.secret,
        publishableKey: config.publishableKey,
        amountCents,
        discountPercent,
        retailCents,
      });
    }

    const mobileSuccessUrl = resolveMobileSuccessUrl(body.mobileSuccessUrl);
    const cancelRaw = typeof body.cancelReturnPath === "string" ? body.cancelReturnPath.trim() : "";
    const successUrl =
      mobileSuccessUrl ??
      `${config.returnUrlBase}/api/stripe/cart-buyout/sync?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = resolveCancelUrl(cancelRaw, config.returnUrlBase, cartId);

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
              name: `Achat fin de location (${pieceCount} pièce${pieceCount > 1 ? "s" : ""})`,
              description:
                discountPercent > 0
                  ? `−${discountPercent} % · commande ${detail.orderNumberCompact}`
                  : `Commande ${detail.orderNumberCompact}`,
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: buyoutMetadata,
    });

    if (!session.url) {
      return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL de paiement." }, { status: 500 });
    }

    return NextResponse.json({
      url: session.url,
      amountCents,
      discountPercent,
      retailCents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer le paiement.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
