import { NextResponse } from "next/server";
import Stripe from "stripe";

import type { CheckoutDeliveryAddress, CheckoutRelaySelection } from "@/lib/cart/checkout-delivery-storage";
import { computeCartFeesHtVatTtc } from "@/lib/cart/cart-checkout-vat";
import { cartPaymentServiceFeeHtCents } from "@/lib/cart/cart-payment-fees";
import { parseRemainingIncludedOrdersThisMonth } from "@/lib/billing/membership-included-orders";
import {
  computeCartCheckoutRoundTripShippingHtCents,
} from "@/lib/billing/cart-checkout-shipping-ht-cents";
import { resolveIncludedExchangeShippingKind } from "@/lib/billing/included-exchange-shipping";
import { EXCHANGE_CREDIT_CENTS_PER_MOD } from "@/lib/cart/exchangeCredits";
import { fetchActiveCartForUser } from "@/lib/cart/fetch-active-cart-lines";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import {
  confirmCartPaidWalletOnly,
  debitCartWalletOnly,
} from "@/lib/stripe/cart-order-fulfillment";
import { notifyCartOrderPaidAfterConfirmation } from "@/lib/notifications/checkout-notifications";
import { getStripeConfig } from "@/lib/social/stripe";
import { buildFranceUberAddressJson } from "@/lib/uber-direct/addresses";
import { readUberDirectConfig } from "@/lib/uber-direct/config";
import { fetchUberDeliveryQuoteRaw } from "@/lib/uber-direct/deliveries-api";
import { uberQuoteFeeCentsFromRaw } from "@/lib/uber-direct/format-quote-for-display";
import { computeExchangeRoundTripShippingCents } from "@/lib/shipping/exchange-shipping-pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForBillingSubscription, walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { parseUserWalletPointsRow } from "@/lib/wallet/user-wallet-row";

type DeliveryChannel = "relay" | "home";
type HomeSpeed = "standard" | "uber_direct" | "priority";

function isDeliveryChannel(v: unknown): v is DeliveryChannel {
  return v === "relay" || v === "home";
}

function isHomeSpeed(v: unknown): v is HomeSpeed {
  return v === "standard" || v === "uber_direct" || v === "priority";
}

/** `priority` = ancien libellé client, traité comme Uber Direct. */
function normalizeHomeSpeedForBilling(v: HomeSpeed): "standard" | "uber_direct" {
  if (v === "uber_direct" || v === "priority") return "uber_direct";
  return "standard";
}

function parseDeliveryAddress(raw: unknown): CheckoutDeliveryAddress | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.label !== "string" || o.label.trim() === "") return null;
  const lat = typeof o.lat === "number" ? o.lat : Number(o.lat);
  const lon = typeof o.lon === "number" ? o.lon : Number(o.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    label: o.label.trim(),
    lat,
    lon,
    city: typeof o.city === "string" ? o.city : null,
    relativeCity: typeof o.relativeCity === "string" ? o.relativeCity : null,
    timezone: typeof o.timezone === "string" ? o.timezone : "Europe/Paris",
  };
}

function parseDeliveryInstructions(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 450);
}

function parseRelaySelection(raw: unknown): CheckoutRelaySelection | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.code !== "string" || o.code.trim() === "") return null;
  if (typeof o.postalCode !== "string" || o.postalCode.replace(/\D/g, "").length < 5) return null;
  if (typeof o.label !== "string" || o.label.trim() === "") return null;
  return {
    code: o.code.trim(),
    label: o.label.trim(),
    postalCode: o.postalCode.trim(),
    city: typeof o.city === "string" ? o.city : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ message: "Corps de requête invalide." }, { status: 400 });
    }

    const deliveryChannel = body.deliveryChannel;
    const homeSpeedRaw = body.homeSpeed ?? "standard";
    if (!isDeliveryChannel(deliveryChannel) || !isHomeSpeed(homeSpeedRaw)) {
      return NextResponse.json({ message: "Options de livraison invalides." }, { status: 400 });
    }

    const homeSpeedBilling = normalizeHomeSpeedForBilling(homeSpeedRaw);
    const deliveryInstructions = parseDeliveryInstructions(body.deliveryInstructions);

    const relaySelection = parseRelaySelection(body.relaySelection);
    const deliveryAddress = parseDeliveryAddress(body.deliveryAddress);

    if (deliveryChannel === "relay" && !relaySelection) {
      return NextResponse.json({ message: "Choisis un point relais." }, { status: 400 });
    }
    if (deliveryChannel === "home" && !deliveryAddress) {
      return NextResponse.json({ message: "Indique une adresse de livraison." }, { status: 400 });
    }

    if (body.acceptRentalTerms !== true) {
      return NextResponse.json(
        { message: "Tu dois confirmer avoir lu les conditions générales de location pour continuer." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const userId = user.id as string;
    const membershipLabel = await resolveMembershipLabel(supabase, userId);

    const activeCart = await fetchActiveCartForUser(
      supabase as unknown as Parameters<typeof fetchActiveCartForUser>[0],
      userId,
    );
    const canPay = activeCart.status === "checkout_pending";
    if (!canPay || !activeCart.cartId) {
      return NextResponse.json({ message: "Panier non éligible au paiement." }, { status: 400 });
    }

    const linesBase = activeCart.lines;
    if (linesBase.length === 0) {
      return NextResponse.json({ message: "Panier vide." }, { status: 400 });
    }

    const itemIdsForComp = [...new Set(linesBase.map((l) => l.itemId))];
    let lines = linesBase;
    if (itemIdsForComp.length > 0) {
      const compRes = await supabase.rpc("get_cart_items_competition_state", { p_item_ids: itemIdsForComp });
      if (compRes.error == null) {
        lines = mergeCompetitionIntoCartLines(linesBase, compRes.data);
      }
    }

    if (lines.some((l) => l.reservedByOther)) {
      return NextResponse.json(
        { message: "Une pièce n’est plus disponible — actualise le panier." },
        { status: 409 },
      );
    }

    const itemCount = lines.length;
    const cartTotalMods = lines.reduce((sum, line) => sum + line.pricePoints, 0);

    const { data: walletRow } = await supabase
      .from("user_wallets")
      .select("balance_points, balance_consumption_points, balance_exchange_points")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();

    const availableWalletMods = parseUserWalletPointsRow(walletRow as Record<string, unknown>).total;
    const cartExceedsWallet = cartTotalMods > availableWalletMods;
    const missingExchangeMods = cartExceedsWallet ? Math.max(0, Math.floor(cartTotalMods - availableWalletMods)) : 0;
    const creditsCents = missingExchangeMods * EXCHANGE_CREDIT_CENTS_PER_MOD;

    const outboundMode = deliveryChannel === "relay" ? "relay" : "home";
    const relayRoundTrip = computeExchangeRoundTripShippingCents(itemCount, "relay");
    const currentRoundTrip = computeExchangeRoundTripShippingCents(itemCount, outboundMode);

    const { data: membershipState } = await supabase.rpc("get_current_membership_state");
    const remainingIncludedOrders = parseRemainingIncludedOrdersThisMonth(membershipState);
    const includedExchangeShipping = resolveIncludedExchangeShippingKind({
      membershipLabel,
      remainingIncludedOrdersThisMonth: remainingIncludedOrders,
    });

    const needsUberQuote =
      deliveryChannel === "home" &&
      homeSpeedBilling === "uber_direct" &&
      includedExchangeShipping !== "member_all_modes";

    let uberFeeCents: number | null = null;
    if (needsUberQuote) {
      if (!deliveryAddress) {
        return NextResponse.json(
          { message: "Adresse de livraison requise pour Uber Direct." },
          { status: 400 },
        );
      }
      const uberConfig = readUberDirectConfig();
      if (!uberConfig) {
        return NextResponse.json(
          { message: "Uber Direct n’est pas configuré sur ce serveur — impossible de lancer le paiement." },
          { status: 503 },
        );
      }
      const dropoffAddressJson = buildFranceUberAddressJson(
        deliveryAddress.label,
        deliveryAddress.city ?? deliveryAddress.relativeCity,
      );
      let quote: Record<string, unknown>;
      try {
        quote = await fetchUberDeliveryQuoteRaw({ config: uberConfig, dropoffAddressJson });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "uber_quote_failed";
        console.error("[stripe/cart/checkout] uber quote for billing failed", msg);
        return NextResponse.json(
          { message: "Impossible d’obtenir le tarif Uber pour cette adresse. Vérifie l’adresse ou réessaie." },
          { status: 502 },
        );
      }
      const parsed = uberQuoteFeeCentsFromRaw(quote);
      if (parsed == null) {
        return NextResponse.json(
          { message: "Réponse Uber inattendue (tarif). Réessaie dans un instant." },
          { status: 502 },
        );
      }
      uberFeeCents = parsed;
    }

    let billedRoundTripHtCents: number;
    try {
      billedRoundTripHtCents = computeCartCheckoutRoundTripShippingHtCents({
        itemCount,
        deliveryChannel,
        homeSpeedBilling,
        includedKind: includedExchangeShipping,
        relayRoundTrip,
        currentRoundTrip,
        uberOutboundHtCents: uberFeeCents,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "shipping_ht_failed";
      console.error("[stripe/cart/checkout] shipping ht cents", msg);
      return NextResponse.json(
        { message: "Impossible de calculer les frais de livraison pour cette combinaison." },
        { status: 400 },
      );
    }

    /** Plus de surtaxe Segna pour Uber : aller facturé = devis API `delivery_quotes` + retour barème relais. */
    const priorityCents = 0;

    const shippingHtCents = billedRoundTripHtCents + priorityCents;
    const serviceHtCents = cartPaymentServiceFeeHtCents(itemCount);
    const fees = computeCartFeesHtVatTtc(shippingHtCents, serviceHtCents);
    const totalCents = creditsCents + fees.feesTtcCents;

    const config = getStripeConfig();

    if (totalCents === 0) {
      const creditsKind = walletCreditKindForMembership(membershipLabel);
      const relayMeta =
        relaySelection != null ? `${relaySelection.code}`.slice(0, 120) : "";
      const deliveryLine1Meta =
        deliveryChannel === "home" && deliveryAddress != null
          ? deliveryAddress.label.trim().slice(0, 450)
          : "";

      try {
        await debitCartWalletOnly(admin as unknown as Parameters<typeof debitCartWalletOnly>[0], userId, activeCart.cartId, creditsKind);
        await confirmCartPaidWalletOnly(
          admin as unknown as Parameters<typeof confirmCartPaidWalletOnly>[0],
          userId,
          activeCart.cartId,
          deliveryChannel,
          relayMeta,
          deliveryLine1Meta,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "wallet_checkout_failed";
        console.error("[stripe/cart/checkout] wallet-only cart completion failed", msg);
        return NextResponse.json(
          { message: "Impossible de finaliser la commande. Réessaie ou contacte le support." },
          { status: 500 },
        );
      }

      try {
        await notifyCartOrderPaidAfterConfirmation(admin, { userId, cartId: activeCart.cartId });
      } catch (e) {
        console.error("[stripe/cart/checkout] notifyCartOrderPaidAfterConfirmation", e);
      }

      return NextResponse.json({ url: `${config.returnUrlBase}/exchange?cart=success` });
    }

    if (totalCents < 50) {
      return NextResponse.json({ message: "Montant trop faible pour Stripe." }, { status: 400 });
    }

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
          metadata: { source: "cart_checkout" },
        },
        { onConflict: "user_id" },
      );
    }

    const stripeWalletTopupKind = walletCreditKindForBillingSubscription(null, null);
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    if (creditsCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: creditsCents,
          product_data: {
            name: "Complément crédits Segna",
            description: `${missingExchangeMods} unité(s) au-delà du solde`,
          },
        },
      });
    }

    if (fees.shippingTtcCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: fees.shippingTtcCents,
          product_data: {
            name: "Livraison échange (aller-retour, TTC)",
            description:
              deliveryChannel === "relay"
                ? relaySelection
                  ? `Point relais — ${relaySelection.label}`
                  : "Point relais"
                : homeSpeedBilling === "uber_direct"
                  ? "Livraison à domicile (Uber Direct + retour relais)"
                  : "Livraison à domicile",
          },
        },
      });
    }

    if (fees.serviceTtcCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: fees.serviceTtcCents,
          product_data: {
            name: "Frais de service (TTC)",
          },
        },
      });
    }

    const relayMeta =
      relaySelection != null
        ? `${relaySelection.code}`.slice(0, 120)
        : "";
    const deliveryLine1Meta =
      deliveryChannel === "home" && deliveryAddress != null
        ? deliveryAddress.label.trim().slice(0, 450)
        : "";
    const successUrl = `${config.returnUrlBase}/api/stripe/cart/sync?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.returnUrlBase}/cart/payment?checkout=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: userId,
      metadata: {
        checkout_kind: "cart_order",
        user_id: userId,
        cart_id: activeCart.cartId,
        item_count: String(itemCount),
        delivery_channel: deliveryChannel,
        home_speed: homeSpeedBilling === "uber_direct" ? "uber_direct" : "standard",
        delivery_lat:
          deliveryChannel === "home" && deliveryAddress != null ? String(deliveryAddress.lat) : "",
        delivery_lon:
          deliveryChannel === "home" && deliveryAddress != null ? String(deliveryAddress.lon) : "",
        delivery_city:
          deliveryChannel === "home" && deliveryAddress != null
            ? (deliveryAddress.city ?? deliveryAddress.relativeCity ?? "").trim().slice(0, 120)
            : "",
        delivery_instructions:
          deliveryChannel === "home" && deliveryInstructions ? deliveryInstructions.slice(0, 450) : "",
        missing_exchange_mods: String(missingExchangeMods),
        /** Historique : clé Stripe « exchange_credits_kind » ; valeur = seau wallet du complément € (consommation). */
        exchange_credits_kind: stripeWalletTopupKind,
        credits_line_cents: String(creditsCents),
        // HT — mêmes champs qu’historique `shipping_cents` / `service_cents`.
        shipping_cents: String(shippingHtCents),
        service_cents: String(serviceHtCents),
        shipping_ht_cents: String(shippingHtCents),
        shipping_ttc_cents: String(fees.shippingTtcCents),
        shipping_round_trip_waived:
          remainingIncludedOrders > 0 && billedRoundTripHtCents === 0 ? "true" : "false",
        shipping_included_kind: String(includedExchangeShipping),
        remaining_included_orders_at_checkout: String(remainingIncludedOrders),
        round_trip_shipping_ht_cents_if_billed: String(billedRoundTripHtCents),
        priority_cents: String(priorityCents),
        service_ht_cents: String(serviceHtCents),
        service_ttc_cents: String(fees.serviceTtcCents),
        fees_vat_cents: String(fees.feesVatCents),
        fees_ttc_cents: String(fees.feesTtcCents),
        relay_code: relayMeta,
        delivery_line1: deliveryLine1Meta,
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
