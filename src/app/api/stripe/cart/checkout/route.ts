import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  type CheckoutDeliveryAddress,
  type CheckoutRelaySelection,
  checkoutRelayProviderPointId,
  checkoutReturnRelayFields,
} from "@/lib/cart/checkout-delivery-storage";
import { computeCartCheckoutShippingFees } from "@/lib/cart/cart-payment-fees";
import { parseRemainingIncludedOrdersThisMonth } from "@/lib/billing/membership-included-orders";
import { computeCartCheckoutRoundTripShippingHtCents } from "@/lib/billing/cart-checkout-shipping-ht-cents";
import { complementQualifiesForFreeRelay } from "@/lib/cart/cart-complement-relay-offer";
import { resolveIncludedExchangeShippingKind } from "@/lib/billing/included-exchange-shipping";
import {
  centsPerMissingCreditForDuration,
  computeMissingCreditsCashCents,
  fetchBorrowCheckoutOptions,
} from "@/lib/billing/fetch-borrow-checkout-options";
import {
  computeGuestCartPurchaseEuroCents,
  computeGuestCartRentalEuroCents,
  guestStripeCompPoints,
  isGuestCashRentalMode,
} from "@/lib/billing/guest-rental-pricing";
import { defaultCheckoutBorrowDurationDays } from "@/lib/cart/checkout-borrow-duration-storage";
import { cartPaymentProfileGateMessage, fetchCartPaymentEligibility } from "@/lib/cart/cart-payment-eligibility";
import { KYC_REQUIRED_FOR_BORROW } from "@/lib/kyc/kyc-policy";
import { fetchOnboardingProfileRequirements } from "@/lib/profile/onboarding-profile-requirements";
import { fetchActiveCartForUser } from "@/lib/cart/fetch-active-cart-lines";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import { buildCartOrderCheckoutMetadata } from "@/lib/stripe/cart-checkout-stripe-metadata";
import {
  confirmCartPaidWalletOnly,
  finalizeCartOutboundSendcloudAfterConfirm,
  resolveCartCheckoutSendcloudOutboundSelection,
} from "@/lib/stripe/cart-order-fulfillment";
import { buildGuestPurchaseCheckoutLineItems } from "@/lib/stripe/guest-purchase-stripe-invoice";
import { exchangeOrderSuccessUrl, orderCheckoutEconomicsDirect, trackOrderConfirmedServer } from "@/lib/analytics/order-confirmed";
import { flushServerAnalytics } from "@/lib/analytics/track-server";
import { stripeCustomerHasSavedPaymentMethod } from "@/lib/stripe/stripe-customer-payment-method";
import { notifyCartOrderPaidAfterConfirmation } from "@/lib/notifications/checkout-notifications";
import { getStripeConfig } from "@/lib/social/stripe";
import { parseFranceCoursierAddress } from "@/lib/coursier/addresses";
import { readCoursierConfig } from "@/lib/coursier/config";
import { fetchCoursierExpressQuote } from "@/lib/coursier/getprice-api";
import { buildDefaultCoursierPackages } from "@/lib/coursier/packages";
import { coursierQuoteFeeCentsFromRaw } from "@/lib/coursier/format-quote-for-display";
import {
  coursierOfferSlotKey,
  findCoursierOfferBySlotKey,
} from "@/lib/coursier/selectable-offers";
import { memberPostalCodeForCheckoutShipping } from "@/lib/cart/checkout-shipping-postal";
import type { CheckoutSendcloudOutboundOption } from "@/lib/cart/checkout-sendcloud-outbound-option";
import { resolveDefaultCheckoutReturnRelayHub } from "@/lib/sendcloud/resolve-checkout-return-relay-hub";
import { resolveCartCheckoutShippingRoundTrips } from "@/lib/sendcloud/resolve-cart-checkout-shipping-round-trips";
import { resolveHomeCheckoutShippingRoundTrip } from "@/lib/sendcloud/checkout-home-delivery-options";
import { resolveRelayCheckoutShippingRoundTrip } from "@/lib/sendcloud/checkout-relay-delivery-options";
import { getSendcloudEnv, isSendcloudCheckoutLivePricingEnabled } from "@/lib/sendcloud/config";
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
  const scRaw = o.sendcloudServicePointId;
  const scNum =
    typeof scRaw === "number"
      ? scRaw
      : typeof scRaw === "string"
        ? parseInt(scRaw, 10)
        : NaN;
  return {
    code: o.code.trim(),
    label: o.label.trim(),
    postalCode: o.postalCode.trim(),
    city: typeof o.city === "string" ? o.city : undefined,
    sendcloudServicePointId: Number.isFinite(scNum) && scNum > 0 ? scNum : undefined,
    sendcloudCarrier:
      typeof o.sendcloudCarrier === "string" && o.sendcloudCarrier.trim()
        ? o.sendcloudCarrier.trim().toLowerCase()
        : undefined,
    sendcloudPostNumber:
      typeof o.sendcloudPostNumber === "string" && o.sendcloudPostNumber.trim()
        ? o.sendcloudPostNumber.trim()
        : undefined,
  };
}

function relayMetaFromSelection(relay: CheckoutRelaySelection): string {
  return checkoutRelayProviderPointId(relay).slice(0, 120);
}

function parseSendcloudOutboundSelection(raw: unknown): CheckoutSendcloudOutboundOption | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const optionCode = typeof o.optionCode === "string" ? o.optionCode.trim() : "";
  if (!optionCode) return null;
  return {
    optionCode,
    optionId: typeof o.optionId === "string" ? o.optionId.trim() : "",
    title: typeof o.title === "string" ? o.title.trim() : "Livraison",
    carrierCode: typeof o.carrierCode === "string" ? o.carrierCode.trim() : "",
    carrierName: typeof o.carrierName === "string" ? o.carrierName.trim() : "",
    shippingRateCents:
      typeof o.shippingRateCents === "number" && Number.isFinite(o.shippingRateCents)
        ? o.shippingRateCents
        : null,
  };
}

function parseBorrowDurationDays(raw: unknown, allowed: ReadonlySet<number>): number | null {
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.trunc(raw)
      : typeof raw === "string" && raw.trim() !== ""
        ? Math.trunc(Number(raw))
        : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 90 || !allowed.has(n)) return null;
  return n;
}

async function persistCartCheckoutBorrowDurationDays(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  cartId: string,
  userId: string,
  durationDays: number,
): Promise<void> {
  const { error } = await admin
    .from("carts")
    .update({ checkout_borrow_duration_days: durationDays, updated_at: new Date().toISOString() })
    .eq("id", cartId)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(error.message);
  }
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
    const coursierSlotKey =
      typeof body.coursierSlotKey === "string" ? body.coursierSlotKey.trim() : "";
    const deliveryInstructions = parseDeliveryInstructions(body.deliveryInstructions);
    const sendcloudOutboundSelection = parseSendcloudOutboundSelection(body.sendcloudOutboundSelection);
    const needsSendcloudOutboundPick =
      isSendcloudCheckoutLivePricingEnabled() &&
      !(deliveryChannel === "home" && homeSpeedBilling === "uber_direct");

    const relaySelection = parseRelaySelection(body.relaySelection);
    const deliveryAddress = parseDeliveryAddress(body.deliveryAddress);

    if (deliveryChannel === "relay" && !relaySelection) {
      return NextResponse.json({ message: "Choisis un point relais." }, { status: 400 });
    }
    if (deliveryChannel === "home" && !deliveryAddress) {
      return NextResponse.json({ message: "Indique une adresse de livraison." }, { status: 400 });
    }

    const returnHubResolved = await resolveDefaultCheckoutReturnRelayHub();
    if (!returnHubResolved.ok) {
      return NextResponse.json({ message: returnHubResolved.error }, { status: returnHubResolved.status });
    }
    const returnRelayFields = checkoutReturnRelayFields(returnHubResolved.selection);

    if (body.acceptRentalTerms !== true) {
      const purchaseTerms = body.purchaseMode === true;
      return NextResponse.json(
        {
          message: purchaseTerms
            ? "Tu dois confirmer avoir lu les conditions générales de vente pour continuer."
            : "Tu dois confirmer avoir lu les conditions générales de location pour continuer.",
        },
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

    const paymentEligibility = await fetchCartPaymentEligibility(supabase as any, admin, userId);
    if (!paymentEligibility.canAccessPayment) {
      const profileRequirements = !paymentEligibility.profileComplete
        ? await fetchOnboardingProfileRequirements(supabase as any, userId)
        : null;
      const message =
        !paymentEligibility.profileComplete
          ? cartPaymentProfileGateMessage(profileRequirements)
          : KYC_REQUIRED_FOR_BORROW
            ? "Valide ton identité (KYC) avant de payer."
            : "Complète ton profil avant de payer.";
      return NextResponse.json({ message, code: "payment_gate" }, { status: 403 });
    }

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

    const guestCashRental = isGuestCashRentalMode(membershipLabel);
    const purchaseMode = guestCashRental && body.purchaseMode === true;
    const outboundOnly = purchaseMode;
    const availableWalletMods = guestCashRental
      ? 0
      : parseUserWalletPointsRow(walletRow as Record<string, unknown>).total;
    const cartExceedsWallet = guestCashRental ? cartTotalMods > 0 : cartTotalMods > availableWalletMods;
    const missingExchangeMods = guestCashRental
      ? guestStripeCompPoints(cartTotalMods)
      : cartExceedsWallet
        ? Math.max(0, Math.floor(cartTotalMods - availableWalletMods))
        : 0;

    const borrowCheckoutOptions = await fetchBorrowCheckoutOptions(supabase as never);
    const allowedBorrowDurations = new Set(borrowCheckoutOptions.map((o) => o.durationDays));
    const needsBorrowDuration = guestCashRental && !purchaseMode ? cartTotalMods > 0 : missingExchangeMods > 0;
    const borrowDurationDays = needsBorrowDuration
      ? parseBorrowDurationDays(body.borrowDurationDays, allowedBorrowDurations)
      : defaultCheckoutBorrowDurationDays(borrowCheckoutOptions);
    if (needsBorrowDuration && borrowDurationDays == null) {
      return NextResponse.json({ message: "Choisis une durée d'emprunt valide." }, { status: 400 });
    }

    const resolvedBorrowDurationDays =
      borrowDurationDays ?? defaultCheckoutBorrowDurationDays(borrowCheckoutOptions);

    const centsPerMissingCredit = centsPerMissingCreditForDuration(
      borrowCheckoutOptions,
      resolvedBorrowDurationDays,
    );
    const creditsCents = guestCashRental
      ? purchaseMode
        ? computeGuestCartPurchaseEuroCents(cartTotalMods)
        : computeGuestCartRentalEuroCents(cartTotalMods, resolvedBorrowDurationDays, borrowCheckoutOptions)
      : missingExchangeMods > 0
        ? computeMissingCreditsCashCents(missingExchangeMods, resolvedBorrowDurationDays, borrowCheckoutOptions)
        : 0;
    const complementRelayFree = complementQualifiesForFreeRelay(
      creditsCents / 100,
      purchaseMode ? "achat" : "location",
    );

    if (needsBorrowDuration && borrowDurationDays != null) {
      try {
        await persistCartCheckoutBorrowDurationDays(admin, activeCart.cartId, userId, borrowDurationDays);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "borrow_duration_persist_failed";
        console.error("[stripe/cart/checkout] checkout_borrow_duration_days", msg);
        return NextResponse.json({ message: "Impossible d'enregistrer la durée d'emprunt." }, { status: 500 });
      }
    }

    const memberPostalCode = memberPostalCodeForCheckoutShipping({
      deliveryChannel,
      relayPostalCode: relaySelection?.postalCode,
      deliveryAddress,
    });

    const relayOutboundOptionCode =
      deliveryChannel === "relay" ? sendcloudOutboundSelection?.optionCode ?? null : null;
    const homeOutboundOptionCode =
      deliveryChannel === "home" && homeSpeedBilling === "standard"
        ? sendcloudOutboundSelection?.optionCode ?? null
        : null;
    const activeOutboundOptionCode =
      deliveryChannel === "relay" ? relayOutboundOptionCode : homeOutboundOptionCode;

    if (needsSendcloudOutboundPick && !activeOutboundOptionCode) {
      return NextResponse.json(
        { message: "Choisis un transporteur pour l’expédition aller." },
        { status: 400 },
      );
    }

    const shippingRoundTrips = await resolveCartCheckoutShippingRoundTrips({
      itemCount,
      memberPostalCode,
      memberCountry: "FR",
      relayOutboundOptionCode,
      homeOutboundOptionCode,
    });
    const relayRoundTrip = shippingRoundTrips.relayRoundTrip;
    let currentRoundTrip =
      deliveryChannel === "relay" ? shippingRoundTrips.relayRoundTrip : shippingRoundTrips.homeRoundTrip;

    if (activeOutboundOptionCode && memberPostalCode.length === 5) {
      const scEnv = getSendcloudEnv();
      if (scEnv) {
        if (deliveryChannel === "relay") {
          const sendcloudRelayTrip = await resolveRelayCheckoutShippingRoundTrip(scEnv, {
            itemCount,
            postalCode: memberPostalCode,
            optionCode: activeOutboundOptionCode,
          });
          if (sendcloudRelayTrip != null) {
            currentRoundTrip = sendcloudRelayTrip;
          }
        } else if (deliveryChannel === "home" && homeSpeedBilling === "standard") {
          const sendcloudHomeTrip = await resolveHomeCheckoutShippingRoundTrip(scEnv, {
            itemCount,
            postalCode: memberPostalCode,
            optionCode: activeOutboundOptionCode,
          });
          if (sendcloudHomeTrip != null) {
            currentRoundTrip = sendcloudHomeTrip;
          }
        }
      }
    }

    const { data: membershipState } = await supabase.rpc("get_current_membership_state");
    const remainingIncludedOrders = parseRemainingIncludedOrdersThisMonth(membershipState);
    const includedExchangeShipping = resolveIncludedExchangeShippingKind({
      membershipLabel,
      remainingIncludedOrdersThisMonth: remainingIncludedOrders,
    });

    const needsExpressQuote =
      deliveryChannel === "home" &&
      homeSpeedBilling === "uber_direct" &&
      includedExchangeShipping === "none";

    let expressOutboundHtCents: number | null = null;
    let coursierSelection: {
      slotKey: string;
      serviceId: string;
      pickupStartDate: string;
      deliveryStartDate: string;
      deliveryEndDate: string;
    } | null = null;
    if (needsExpressQuote) {
      if (!deliveryAddress) {
        return NextResponse.json(
          { message: "Adresse de livraison requise pour la livraison express." },
          { status: 400 },
        );
      }
      const coursierConfig = readCoursierConfig();
      if (!coursierConfig) {
        return NextResponse.json(
          { message: "Coursier.fr n’est pas configuré sur ce serveur — impossible de lancer le paiement." },
          { status: 503 },
        );
      }
      const toAddress = parseFranceCoursierAddress(
        deliveryAddress.label,
        deliveryAddress.city ?? deliveryAddress.relativeCity,
      );
      if (!toAddress.PostalCode || !toAddress.Address) {
        return NextResponse.json(
          { message: "Adresse de livraison incomplète (rue ou code postal manquant)." },
          { status: 400 },
        );
      }
      try {
        const quote = await fetchCoursierExpressQuote({
          config: coursierConfig,
          fromAddress: coursierConfig.pickupAddress,
          toAddress,
          packages: buildDefaultCoursierPackages(itemCount),
          slotKey: coursierSlotKey || null,
        });
        if (coursierSlotKey && !findCoursierOfferBySlotKey(quote.offers, coursierSlotKey)) {
          return NextResponse.json(
            { message: "Créneau express invalide ou expiré. Choisis un autre créneau." },
            { status: 400 },
          );
        }
        const parsed = coursierQuoteFeeCentsFromRaw(quote);
        if (parsed == null) {
          return NextResponse.json(
            { message: "Réponse Coursier inattendue (tarif). Réessaie dans un instant." },
            { status: 502 },
          );
        }
        expressOutboundHtCents = parsed;
        coursierSelection = {
          slotKey: coursierOfferSlotKey({
            ServiceId: quote.serviceId,
            Service: quote.service,
            PickupStartDate: quote.pickupStartDate,
            PickupEndDate: quote.pickupEndDate,
            DeliveryStartDate: quote.deliveryStartDate,
            DeliveryEndDate: quote.deliveryEndDate,
            Price: String(quote.priceHtCents / 100),
          }),
          serviceId: quote.serviceId,
          pickupStartDate: quote.pickupStartDate,
          deliveryStartDate: quote.deliveryStartDate,
          deliveryEndDate: quote.deliveryEndDate,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "coursier_quote_failed";
        console.error("[stripe/cart/checkout] coursier quote for billing failed", msg);
        return NextResponse.json(
          { message: "Impossible d’obtenir le tarif express pour cette adresse. Vérifie l’adresse ou réessaie." },
          { status: 502 },
        );
      }
    }

    let billedRoundTripHtCents: number;
    try {
      billedRoundTripHtCents = computeCartCheckoutRoundTripShippingHtCents({
        itemCount,
        deliveryChannel,
        homeSpeedBilling,
        includedKind: includedExchangeShipping,
        complementRelayFree,
        relayRoundTrip,
        currentRoundTrip,
        uberOutboundHtCents: expressOutboundHtCents,
        outboundOnly,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "shipping_ht_failed";
      console.error("[stripe/cart/checkout] shipping ht cents", msg);
      return NextResponse.json(
        { message: "Impossible de calculer les frais de livraison pour cette combinaison." },
        { status: 400 },
      );
    }

    /** Aller express facturé = devis Coursier `getprice` + retour barème relais. */
    const priorityCents = 0;

    const shippingHtCents = billedRoundTripHtCents + priorityCents;
    const fees = computeCartCheckoutShippingFees(shippingHtCents);
    const serviceHtCents = fees.serviceHtCents;
    const totalCents = creditsCents + fees.feesTtcCents;

    const config = getStripeConfig();

    const usedIncludedOrder = includedExchangeShipping !== "none";

    if (totalCents === 0) {
      if (guestCashRental && cartTotalMods > 0) {
        return NextResponse.json(
          {
            message: purchaseMode
              ? "Le prix d'achat est requis pour finaliser la commande."
              : "Le prix de location est requis pour finaliser la commande.",
          },
          { status: 400 },
        );
      }
      const creditsKind = walletCreditKindForMembership(membershipLabel);
      const relayMeta = relaySelection != null ? relayMetaFromSelection(relaySelection) : "";
      const deliveryLine1Meta =
        deliveryChannel === "home" && deliveryAddress != null
          ? deliveryAddress.label.trim().slice(0, 450)
          : "";
      const checkoutMetadata = buildCartOrderCheckoutMetadata({
        checkoutKind: "cart_order_wallet_setup",
        userId,
        cartId: activeCart.cartId,
        itemCount,
        deliveryChannel,
        homeSpeedBilling,
        deliveryAddress,
        deliveryInstructions,
        relayMeta,
        deliveryLine1Meta,
        returnRelayFields,
        missingExchangeMods,
        cartTotalMods,
        borrowDurationDays: resolvedBorrowDurationDays,
        centsPerMissingCredit,
        exchangeCreditsKind: creditsKind,
        creditsCents,
        shippingHtCents,
        serviceHtCents,
        fees,
        billedRoundTripHtCents,
        remainingIncludedOrders,
        usedIncludedOrder,
        includedExchangeShipping,
        priorityCents,
        sendcloudOutboundSelection,
        coursierSelection,
        guestCashRental,
      });

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

      const hasSavedPaymentMethod = await stripeCustomerHasSavedPaymentMethod(stripe, admin, userId);
      if (!hasSavedPaymentMethod) {
        const setupSession = await stripe.checkout.sessions.create({
          mode: "setup",
          customer: stripeCustomerId,
          currency: "eur",
          payment_method_types: ["card"],
          success_url: `${config.returnUrlBase}/api/stripe/cart/setup-sync?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${config.returnUrlBase}/cart/payment?checkout=cancelled`,
          client_reference_id: userId,
          metadata: checkoutMetadata,
        });

        if (!setupSession.url) {
          return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL d'enregistrement carte." }, { status: 500 });
        }

        return NextResponse.json({ url: setupSession.url });
      }

      try {
        await confirmCartPaidWalletOnly(
          admin as unknown as Parameters<typeof confirmCartPaidWalletOnly>[0],
          userId,
          activeCart.cartId,
          deliveryChannel,
          relayMeta,
          deliveryLine1Meta,
          returnRelayFields,
          creditsKind,
        );
        const walletSendcloudOutbound = await resolveCartCheckoutSendcloudOutboundSelection({
          deliveryChannel,
          clientSelection: sendcloudOutboundSelection,
          activeOutboundOptionCode,
          relayCarrierHint: relaySelection?.sendcloudCarrier,
          itemCount,
          memberPostalCode,
        });
        await finalizeCartOutboundSendcloudAfterConfirm(
          admin as unknown as Parameters<typeof finalizeCartOutboundSendcloudAfterConfirm>[0],
          {
            cartId: activeCart.cartId,
            deliveryChannel,
            homeSpeed: homeSpeedBilling === "uber_direct" ? "uber_direct" : "standard",
            sendcloudOutbound: walletSendcloudOutbound,
          },
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
        await notifyCartOrderPaidAfterConfirmation(admin, {
          userId,
          cartId: activeCart.cartId,
          skipMemberNotification: purchaseMode,
        });
      } catch (e) {
        console.error("[stripe/cart/checkout] notifyCartOrderPaidAfterConfirmation", e);
      }

      trackOrderConfirmedServer(userId, {
        cart_id: activeCart.cartId,
        checkout_mode: "wallet_only",
        used_included_order: checkoutMetadata.used_included_order === "true",
        item_count: itemCount,
        ...orderCheckoutEconomicsDirect({
          cartTotalMods,
          cashPaidCents: 0,
          missingExchangeMods,
          borrowDurationDays: resolvedBorrowDurationDays,
        }),
      });
      await flushServerAnalytics();

      return NextResponse.json({
        url: `${config.returnUrlBase}${exchangeOrderSuccessUrl("", activeCart.cartId, "wallet_only", itemCount)}`,
      });
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
    const relayMeta = relaySelection != null ? relayMetaFromSelection(relaySelection) : "";
    const deliveryLine1Meta =
      deliveryChannel === "home" && deliveryAddress != null
        ? deliveryAddress.label.trim().slice(0, 450)
        : "";
    const checkoutMetadata = buildCartOrderCheckoutMetadata({
      checkoutKind: "cart_order",
      userId,
      cartId: activeCart.cartId,
      itemCount,
      deliveryChannel,
      homeSpeedBilling,
      deliveryAddress,
      deliveryInstructions,
      relayMeta,
      deliveryLine1Meta,
      returnRelayFields,
      missingExchangeMods,
      cartTotalMods,
      borrowDurationDays: resolvedBorrowDurationDays,
      centsPerMissingCredit,
      exchangeCreditsKind: stripeWalletTopupKind,
      creditsCents,
      shippingHtCents,
      serviceHtCents,
      fees,
      billedRoundTripHtCents,
      remainingIncludedOrders,
      usedIncludedOrder,
      includedExchangeShipping,
      priorityCents,
      sendcloudOutboundSelection,
      coursierSelection,
      guestCashRental,
      purchaseMode,
    });

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    if (purchaseMode) {
      const shippingDescription =
        deliveryChannel === "relay"
          ? relaySelection
            ? `Livraison point relais — ${relaySelection.label}`
            : "Livraison point relais (TTC)"
          : homeSpeedBilling === "uber_direct"
            ? "Livraison à domicile express (Coursier.fr, TTC)"
            : "Livraison à domicile (aller, TTC)";
      lineItems = await buildGuestPurchaseCheckoutLineItems(admin, {
        cartId: activeCart.cartId,
        itemsCents: creditsCents,
        shippingTtcCents: fees.shippingTtcCents,
        shippingDescription,
        serviceTtcCents: fees.serviceTtcCents,
      });
    } else if (creditsCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: creditsCents,
          product_data: {
            name: guestCashRental
              ? purchaseMode
                ? "Prix d'achat"
                : "Prix de location"
              : "Complément crédits Segna",
            description: guestCashRental
              ? purchaseMode
                ? "Achat définitif"
                : `Location · ${resolvedBorrowDurationDays} j`
              : `${missingExchangeMods} crédit(s) manquant(s) · ${resolvedBorrowDurationDays} j`,
          },
        },
      });
    }

    if (!purchaseMode && fees.shippingTtcCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: fees.shippingTtcCents,
          product_data: {
            name: purchaseMode ? "Livraison (aller, TTC)" : "Livraison échange (aller-retour, TTC)",
            description:
              deliveryChannel === "relay"
                ? relaySelection
                  ? `Point relais — ${relaySelection.label}`
                  : "Point relais"
                : homeSpeedBilling === "uber_direct"
                  ? purchaseMode
                    ? "Livraison à domicile (Coursier.fr)"
                    : "Livraison à domicile (Coursier.fr + retour relais)"
                  : "Livraison à domicile",
          },
        },
      });
    }

    if (!purchaseMode && fees.serviceTtcCents > 0) {
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

    if (lineItems.length === 0) {
      return NextResponse.json({ message: "Montant trop faible pour Stripe." }, { status: 400 });
    }

    const successUrl = `${config.returnUrlBase}/api/stripe/cart/sync?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.returnUrlBase}/cart/payment?checkout=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      payment_intent_data: {
        setup_future_usage: "off_session",
      },
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: userId,
      metadata: checkoutMetadata,
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
