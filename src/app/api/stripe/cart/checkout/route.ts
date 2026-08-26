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
import {
  computeCartCheckoutRoundTripShippingHtCents,
  type CartCheckoutHomePlanKind,
} from "@/lib/billing/cart-checkout-shipping-ht-cents";
import { complementQualifiesForFreeRelay } from "@/lib/cart/cart-complement-relay-offer";
import { purchasePromoGrantsFreeShipping } from "@/lib/cart/purchase-promo-codes";
import { resolveIncludedExchangeShippingKind } from "@/lib/billing/included-exchange-shipping";
import {
  centsPerMissingCreditForDuration,
  computeMemberBorrowComplementCashCents,
  MEMBER_BORROW_COMPLEMENT_CENTS_PER_CREDIT,
  MEMBER_BORROW_COMPLEMENT_DURATION_DAYS,
  fetchBorrowCheckoutOptions,
} from "@/lib/billing/fetch-borrow-checkout-options";
import {
  computeGuestCartPurchaseEuroCents,
  computeGuestCartRentalEuroCents,
  computeMemberCartPurchaseEuroCents,
  guestStripeCompPoints,
  isGuestCashRentalMode,
} from "@/lib/billing/guest-rental-pricing";
import { defaultCheckoutBorrowDurationDays } from "@/lib/cart/checkout-borrow-duration-storage";
import {
  cartPaymentPhoneGateMessage,
  cartPaymentProfileGateMessage,
  fetchCartPaymentEligibility,
} from "@/lib/cart/cart-payment-eligibility";
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
import { ensureStripeBillingCustomer } from "@/lib/stripe/ensure-billing-customer";
import { stripeCustomerHasSavedPaymentMethod } from "@/lib/stripe/stripe-customer-payment-method";
import { notifyCartOrderPaidAfterConfirmation } from "@/lib/notifications/checkout-notifications";
import { getStripeConfig } from "@/lib/social/stripe";
import { stripeFrVat20TaxParams } from "@/lib/stripe/fr-vat-tax-rate";
import { parseFranceCoursierAddress } from "@/lib/coursier/addresses";
import { readCoursierConfig } from "@/lib/coursier/config";
import { isCoursierCheckoutEnabled } from "@/lib/coursier/coursier-checkout-enabled";
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
import {
  fetchCheckoutHomeSendcloudPricing,
  resolveHomeCheckoutShippingRoundTrip,
} from "@/lib/sendcloud/checkout-home-delivery-options";
import { resolveRelayCheckoutShippingRoundTrip } from "@/lib/sendcloud/checkout-relay-delivery-options";
import { getSendcloudEnv, isSendcloudCheckoutLivePricingEnabled } from "@/lib/sendcloud/config";
import { getWebsiteOrigin } from "@/lib/auth/website-checkout-onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForBillingSubscription, walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { parseUserWalletPointsRow } from "@/lib/wallet/user-wallet-row";

function resolveCartCancelUrl(cancelRaw: string, returnUrlBase: string): string {
  const websiteOrigin = getWebsiteOrigin();
  /** Deep link Expo (`segna://…`) — retour app après annulation Checkout. */
  if (cancelRaw.startsWith("segna://") && !cancelRaw.includes("..")) {
    return cancelRaw;
  }
  if (
    (cancelRaw.startsWith(`${websiteOrigin}/`) || cancelRaw === websiteOrigin) &&
    !cancelRaw.includes("..")
  ) {
    return cancelRaw;
  }
  try {
    const parsed = new URL(cancelRaw);
    if (
      (parsed.pathname.startsWith("/panier") || parsed.pathname.startsWith("/abonnement")) &&
      !cancelRaw.includes("..")
    ) {
      return cancelRaw;
    }
  } catch {
    // ignore
  }
  if (cancelRaw.startsWith("/panier") && !cancelRaw.includes("..")) {
    return `${websiteOrigin}${cancelRaw}`;
  }
  return `${returnUrlBase}/cart/payment?checkout=cancelled`;
}

function resolveMobileSuccessUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("segna://") || trimmed.includes("..")) return null;
  return trimmed.includes("{CHECKOUT_SESSION_ID}")
    ? trimmed
    : `${trimmed}${trimmed.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
}

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
    let sendcloudOutboundSelection = parseSendcloudOutboundSelection(body.sendcloudOutboundSelection);
    const purchaseModeEarly = body.purchaseMode === true;
    const needsSendcloudOutboundPick =
      isSendcloudCheckoutLivePricingEnabled() &&
      !(deliveryChannel === "home" && homeSpeedBilling === "uber_direct") &&
      // Website purchase : barème interne / Sendcloud sans sélection UI transporteur.
      !purchaseModeEarly;

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

    const {
      user,
      error: userError,
      supabase,
    } = await resolveRequestUserClient(request);
    const admin = createSupabaseAdminClient();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const userId = user.id as string;

    const paymentEligibility = await fetchCartPaymentEligibility(supabase as any, admin, userId);
    if (!paymentEligibility.canAccessPayment) {
      // Achat website : prénom + adresse + téléphone (pas tailles / âge / KYC obligatoires).
      let websitePurchaseReady = false;
      if (purchaseModeEarly) {
        const [{ data: memberRow }, { data: profileRow }] = await Promise.all([
          admin.from("users").select("first_name, adress, phone").eq("id", userId).maybeSingle(),
          admin.from("user_profiles").select("profile_data").eq("user_id", userId).maybeSingle(),
        ]);
        const member = memberRow as {
          first_name?: string | null;
          adress?: string | null;
          phone?: string | null;
        } | null;
        const profileData = ((profileRow as { profile_data?: Record<string, unknown> } | null)
          ?.profile_data ?? {}) as Record<string, unknown>;
        const location = (profileData.location ?? {}) as Record<string, unknown>;
        const phoneE164 =
          typeof profileData.phone_e164 === "string" ? profileData.phone_e164.trim() : "";
        const hasName = Boolean(member?.first_name?.trim());
        const hasAddress = Boolean(
          member?.adress?.trim() ||
            (typeof location.label === "string" && location.label.trim()),
        );
        const hasPhone = Boolean(phoneE164 || member?.phone?.trim());
        websitePurchaseReady = hasName && hasAddress && hasPhone;
      }
      if (!websitePurchaseReady) {
        const profileRequirements = !paymentEligibility.profileComplete
          ? await fetchOnboardingProfileRequirements(supabase as any, userId)
          : null;
        const message = purchaseModeEarly
          ? !websitePurchaseReady
            ? "Complète ton nom, ton adresse et ton téléphone pour payer."
            : "Complète tes informations pour payer."
          : !paymentEligibility.profileComplete
            ? cartPaymentProfileGateMessage(profileRequirements)
            : !paymentEligibility.phoneReady
              ? cartPaymentPhoneGateMessage()
              : KYC_REQUIRED_FOR_BORROW
                ? "Valide ton identité (KYC) avant de payer."
                : "Complète ton profil avant de payer.";
        return NextResponse.json({ message, code: "payment_gate" }, { status: 403 });
      }
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
    const purchaseMode = body.purchaseMode === true;
    /** Proxy website : Chronopost domicile offert dès 200 € (sinon app = relais seulement / supplément Chrono). */
    const websitePurchaseCheckout = body.websitePurchaseCheckout === true;
    const promoFreeShipping = purchasePromoGrantsFreeShipping(body.promoCode);
    const outboundOnly = purchaseMode;
    const availableWalletMods =
      guestCashRental || purchaseMode
        ? 0
        : parseUserWalletPointsRow(walletRow as Record<string, unknown>).total;
    const cartExceedsWallet = guestCashRental || purchaseMode
      ? cartTotalMods > 0
      : cartTotalMods > availableWalletMods;
    const missingExchangeMods = guestCashRental
      ? guestStripeCompPoints(cartTotalMods)
      : purchaseMode
        ? 0
        : cartExceedsWallet
          ? Math.max(0, Math.floor(cartTotalMods - availableWalletMods))
          : 0;

    let purchaseDiscountPercent = 0;
    // Website : prix catalogue plein (`applyMemberPurchaseDiscount: false`). App : réduction membre.
    const applyMemberPurchaseDiscount = body.applyMemberPurchaseDiscount !== false;
    if (!guestCashRental && purchaseMode && applyMemberPurchaseDiscount) {
      const planCode = membershipLabel === "Membre X" ? "segna_x" : membershipLabel === "Membre +" ? "segna_plus" : null;
      if (planCode) {
        const { data: limitRow } = await admin
          .from("billing_plan_entitlement_limits")
          .select("purchase_discount_percent")
          .eq("plan_code", planCode)
          .eq("is_active", true)
          .maybeSingle();
        const raw = Number(limitRow?.purchase_discount_percent ?? 0);
        purchaseDiscountPercent = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.trunc(raw))) : 0;
        if (planCode === "segna_x" && purchaseDiscountPercent <= 0) purchaseDiscountPercent = 20;
      }
    }

    const borrowCheckoutOptions = await fetchBorrowCheckoutOptions(supabase as never);
    const allowedBorrowDurations = new Set(borrowCheckoutOptions.map((o) => o.durationDays));
    const needsBorrowDuration =
      purchaseMode ? false : guestCashRental ? cartTotalMods > 0 : missingExchangeMods > 0;
    // Abonné location : complément toujours 1 mois @ 10 %. Guest : durée choisie (7/14/30).
    const borrowDurationDays =
      purchaseMode
        ? null
        : !guestCashRental && missingExchangeMods > 0
          ? MEMBER_BORROW_COMPLEMENT_DURATION_DAYS
          : needsBorrowDuration
            ? parseBorrowDurationDays(body.borrowDurationDays, allowedBorrowDurations)
            : defaultCheckoutBorrowDurationDays(borrowCheckoutOptions);
    if (needsBorrowDuration && borrowDurationDays == null) {
      return NextResponse.json({ message: "Choisis une durée d'emprunt valide." }, { status: 400 });
    }

    const resolvedBorrowDurationDays =
      purchaseMode
        ? defaultCheckoutBorrowDurationDays(borrowCheckoutOptions)
        : !guestCashRental && missingExchangeMods > 0
          ? MEMBER_BORROW_COMPLEMENT_DURATION_DAYS
          : (borrowDurationDays ?? defaultCheckoutBorrowDurationDays(borrowCheckoutOptions));

    const centsPerMissingCredit = !guestCashRental && !purchaseMode && missingExchangeMods > 0
      ? MEMBER_BORROW_COMPLEMENT_CENTS_PER_CREDIT
      : centsPerMissingCreditForDuration(borrowCheckoutOptions, resolvedBorrowDurationDays);
    const creditsCents = purchaseMode
      ? guestCashRental
        ? computeGuestCartPurchaseEuroCents(cartTotalMods)
        : computeMemberCartPurchaseEuroCents(cartTotalMods, purchaseDiscountPercent)
      : guestCashRental
        ? computeGuestCartRentalEuroCents(cartTotalMods, resolvedBorrowDurationDays, borrowCheckoutOptions)
        : missingExchangeMods > 0
          ? computeMemberBorrowComplementCashCents(missingExchangeMods)
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

    // Achat sans choix transporteur (website) : Chronopost domicile (18h) par défaut,
    // pour que la sélection Sendcloud soit tarifée et enregistrée sur le panier (BO/étiquette).
    if (
      purchaseMode &&
      deliveryChannel === "home" &&
      homeSpeedBilling === "standard" &&
      !sendcloudOutboundSelection?.optionCode?.trim() &&
      memberPostalCode.length === 5
    ) {
      const scEnvDefault = getSendcloudEnv();
      if (scEnvDefault) {
        const homeQuotes = await fetchCheckoutHomeSendcloudPricing(scEnvDefault, {
          itemCount,
          memberPostalCode,
        });
        if (homeQuotes.ok) {
          const defaultHomeOption =
            homeQuotes.pricing.methodOptions.find((o) => o.methodKey === "chronopost") ??
            homeQuotes.pricing.methodOptions[0] ??
            null;
          if (defaultHomeOption) {
            sendcloudOutboundSelection = {
              optionCode: defaultHomeOption.optionCode,
              optionId: defaultHomeOption.deliveryMethodId,
              title: defaultHomeOption.title,
              carrierCode: defaultHomeOption.carrierCode,
              carrierName: defaultHomeOption.carrierName,
              shippingRateCents: defaultHomeOption.outboundTtcCents,
            };
          }
        } else {
          console.error("[stripe/cart/checkout] default chronopost home option", homeQuotes.error);
        }
      }
    }

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
    let homePlanKind: CartCheckoutHomePlanKind | null = null;

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
            homePlanKind = sendcloudHomeTrip.methodKey;
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

    // Toujours requérir le devis Express si sélectionné (y compris avec échange inclus → supplément).
    const needsExpressQuote = deliveryChannel === "home" && homeSpeedBilling === "uber_direct";

    let expressOutboundHtCents: number | null = null;
    let coursierSelection: {
      slotKey: string;
      serviceId: string;
      pickupStartDate: string;
      deliveryStartDate: string;
      deliveryEndDate: string;
    } | null = null;
    if (needsExpressQuote) {
      if (!isCoursierCheckoutEnabled()) {
        return NextResponse.json(
          { message: "Livraison express Coursier.fr désactivée sur cet environnement." },
          { status: 400 },
        );
      }
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
        websitePurchaseFreeHomeShipping:
          websitePurchaseCheckout && purchaseMode && complementRelayFree,
        promoFreeShipping: purchaseMode && promoFreeShipping,
        homePlanKind,
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

    // Quota « échange inclus » (1/mois SegnaX) ≠ livraison offerte (désactivée).
    const usedIncludedOrder = !purchaseMode && remainingIncludedOrders > 0;

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

      const stripeCustomerId = await ensureStripeBillingCustomer({
        stripe,
        admin,
        userId,
        email: user.email,
        source: "cart_checkout",
      });

      const hasSavedPaymentMethod = await stripeCustomerHasSavedPaymentMethod(stripe, admin, userId);
      if (!hasSavedPaymentMethod) {
        const wantsPaymentSheetSetup =
          body.paymentUi === "payment_sheet" || body.paymentUi === "native";

        /** Mobile : SetupIntent + Payment Sheet (évite Checkout URL hors app). */
        if (wantsPaymentSheetSetup) {
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
          const setupIntent = await stripe.setupIntents.create({
            customer: stripeCustomerId,
            payment_method_types: ["card"],
            usage: "off_session",
            metadata: checkoutMetadata,
          });
          if (!setupIntent.client_secret || !ephemeralKey.secret) {
            return NextResponse.json(
              { message: "Stripe n'a pas renvoyé les secrets Setup Payment Sheet." },
              { status: 500 },
            );
          }
          return NextResponse.json({
            paymentUi: "payment_sheet",
            mode: "setup",
            setupIntentId: setupIntent.id,
            setupIntentClientSecret: setupIntent.client_secret,
            customerId: stripeCustomerId,
            customerEphemeralKeySecret: ephemeralKey.secret,
            publishableKey: config.publishableKey,
            amountCents: 0,
          });
        }

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

    const stripeCustomerId = await ensureStripeBillingCustomer({
      stripe,
      admin,
      userId,
      email: user.email,
      source: "cart_checkout",
    });

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
    const vat = stripeFrVat20TaxParams();

    if (purchaseMode) {
      const shippingDescription =
        deliveryChannel === "relay"
          ? relaySelection
            ? `Livraison point relais — ${relaySelection.label}`
            : "Livraison point relais (TTC)"
          : homeSpeedBilling === "uber_direct"
            ? "Livraison à domicile express (Coursier.fr, TTC)"
            : homePlanKind === "chronopost"
              ? "Livraison à domicile — Chronopost 18h (TTC)"
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
          ...(vat.tax_behavior ? { tax_behavior: vat.tax_behavior } : {}),
          product_data: {
            name: guestCashRental
              ? purchaseMode
                ? "Prix d'achat"
                : "Prix de location"
              : "Complément budget SegnaX",
            description: guestCashRental
              ? purchaseMode
                ? "Achat définitif"
                : `Location · ${resolvedBorrowDurationDays} j`
              : `${missingExchangeMods} € manquant(s) · 1 mois à 10 %`,
          },
        },
        ...(vat.tax_rates ? { tax_rates: vat.tax_rates } : {}),
      });
    }

    if (!purchaseMode && fees.shippingTtcCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: fees.shippingTtcCents,
          ...(vat.tax_behavior ? { tax_behavior: vat.tax_behavior } : {}),
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
        ...(vat.tax_rates ? { tax_rates: vat.tax_rates } : {}),
      });
    }

    if (!purchaseMode && fees.serviceTtcCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: fees.serviceTtcCents,
          ...(vat.tax_behavior ? { tax_behavior: vat.tax_behavior } : {}),
          product_data: {
            name: "Frais de service (TTC)",
          },
        },
        ...(vat.tax_rates ? { tax_rates: vat.tax_rates } : {}),
      });
    }

    if (lineItems.length === 0) {
      return NextResponse.json({ message: "Montant trop faible pour Stripe." }, { status: 400 });
    }

    const wantsPaymentSheet =
      body.paymentUi === "payment_sheet" || body.paymentUi === "native";

    /** Mobile in-app : PaymentIntent + Payment Sheet (pas de Checkout URL). */
    if (wantsPaymentSheet) {
      if (!config.publishableKey) {
        return NextResponse.json(
          { message: "STRIPE_PUBLISHABLE_KEY manquante côté serveur." },
          { status: 500 },
        );
      }
      if (totalCents < 50) {
        return NextResponse.json({ message: "Montant trop faible pour Stripe." }, { status: 400 });
      }

      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: stripeCustomerId },
        { apiVersion: "2026-02-25.clover" },
      );

      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalCents,
        currency: "eur",
        customer: stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        ...(purchaseMode
          ? {}
          : {
              setup_future_usage: "off_session" as const,
            }),
        metadata: checkoutMetadata,
        description: purchaseMode
          ? "Commande Segna — achat"
          : guestCashRental
            ? "Commande Segna — location"
            : "Commande Segna — complément / livraison",
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
        amountCents: totalCents,
      });
    }

    const cancelRaw =
      typeof body.cancelReturnPath === "string" ? body.cancelReturnPath.trim() : "";
    const cancelUrl = cancelRaw
      ? resolveCartCancelUrl(cancelRaw, config.returnUrlBase)
      : `${config.returnUrlBase}/cart/payment?checkout=cancelled`;

    const mobileSuccessUrl = resolveMobileSuccessUrl(body.mobileSuccessUrl);
    let successUrl =
      mobileSuccessUrl ??
      `${config.returnUrlBase}/api/stripe/cart/sync?session_id={CHECKOUT_SESSION_ID}`;
    if (!mobileSuccessUrl) {
      try {
        const cancelParsed = new URL(cancelUrl);
        if (cancelParsed.pathname.startsWith("/panier")) {
          successUrl = `${cancelParsed.origin}/panier/succes?session_id={CHECKOUT_SESSION_ID}`;
        }
      } catch {
        // keep app sync
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      // Achat définitif : paiement one-shot → pas de setup_future_usage
      // (sinon Stripe filtre Klarna / BNPL et ne laisse souvent que la carte).
      // Location / complément : on conserve la carte pour prélèvements off_session.
      ...(purchaseMode
        ? {}
        : {
            payment_intent_data: {
              setup_future_usage: "off_session" as const,
            },
          }),
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
