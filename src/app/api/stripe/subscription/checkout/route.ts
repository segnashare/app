import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getWebsiteOrigin } from "@/lib/auth/website-checkout-onboarding";
import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
import { getStripeConfig } from "@/lib/social/stripe";
import { ensureStripeBillingCustomer } from "@/lib/stripe/ensure-billing-customer";
import { resolveFrVat20TaxRateId } from "@/lib/stripe/fr-vat-tax-rate";
import { SEGNAX_BANK_HOLD_AMOUNT_CENTS } from "@/lib/stripe/segnax-subscription-bank-hold";
import {
  normalizeFirstMonthPercentOff,
  resolveFirstMonthPercentOffCouponId,
} from "@/lib/stripe/subscription-first-month-coupon";
import { syncStripeCustomerBillingAddressFromProfile } from "@/lib/stripe/sync-customer-billing-address-from-profile";
import { isPhoneVerified } from "@/lib/phone/phone-verified";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

type PlanCode = "segna_plus" | "segna_x";

const STRIPE_EPHEMERAL_KEY_API_VERSION = "2026-02-25.clover" as const;

function isPlanCode(value: unknown): value is PlanCode {
  return value === "segna_plus" || value === "segna_x";
}

/** Période d’essai Stripe (jours) : seulement `segna_x`, plage 1–45 pour limiter les abus. */
function normalizeSubscriptionTrialPeriodDays(planCode: PlanCode, raw: unknown): number | undefined {
  if (planCode !== "segna_x" || raw == null) return undefined;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(String(raw).trim(), 10) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const days = Math.floor(n);
  if (days < 1 || days > 45) return undefined;
  return days;
}

function getFallbackPriceId(planCode: PlanCode): string | null {
  if (planCode === "segna_plus") {
    const value = process.env.STRIPE_PRICE_SEGNA_PLUS?.trim() ?? "";
    return value.length > 0 ? value : null;
  }
  // Prod Vercel historique : `STRIPE_PRICE_SEGNAX` (sans `_` avant X).
  const value =
    process.env.STRIPE_PRICE_SEGNA_X?.trim() ||
    process.env.STRIPE_PRICE_SEGNAX?.trim() ||
    "";
  return value.length > 0 ? value : null;
}

function resolveMobileSuccessUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("segna://") || trimmed.includes("..")) return null;
  return trimmed.includes("{CHECKOUT_SESSION_ID}")
    ? trimmed
    : `${trimmed}${trimmed.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
}

function resolveCancelUrl(cancelRaw: string, returnUrlBase: string): string {
  const websiteOrigin = getWebsiteOrigin();
  if (cancelRaw.startsWith("segna://") && !cancelRaw.includes("..")) {
    return cancelRaw;
  }
  if (
    (cancelRaw.startsWith(`${websiteOrigin}/`) || cancelRaw === websiteOrigin) &&
    !cancelRaw.includes("..")
  ) {
    return cancelRaw;
  }
  if (cancelRaw.startsWith("/abonnement/") && !cancelRaw.includes("..")) {
    return `${websiteOrigin}${cancelRaw}`;
  }
  if (cancelRaw.startsWith("/package") && !cancelRaw.includes("..")) {
    return `${returnUrlBase}${cancelRaw}`;
  }
  return `${returnUrlBase}/package?checkout=cancelled`;
}

function paymentIntentIdFromClientSecret(secret: string): string | undefined {
  const match = /^(pi_[A-Za-z0-9]+)_secret_/.exec(secret);
  return match?.[1];
}

async function cancelIncompleteSubscriptionsForCustomer(stripe: Stripe, customerId: string) {
  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: "incomplete",
    limit: 10,
  });
  await Promise.all(
    listed.data.map((sub) =>
      stripe.subscriptions.cancel(sub.id).catch((error) => {
        console.warn("[stripe/subscription/checkout] cancel incomplete", sub.id, error);
      }),
    ),
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      planCode?: unknown;
      cancelReturnPath?: unknown;
      mobileSuccessUrl?: unknown;
      trialPeriodDays?: unknown;
      firstMonthPercentOff?: unknown;
      /** Empreinte bancaire SegnaX (100 €) après validation carte. */
      bankHold?: unknown;
      /** Mobile : Payment Sheet in-app (pas d’URL Checkout). */
      paymentUi?: unknown;
    } | null;
    const planCode = body?.planCode;
    if (!isPlanCode(planCode)) {
      return NextResponse.json({ message: "Plan invalide." }, { status: 400 });
    }
    const trialPeriodDays = normalizeSubscriptionTrialPeriodDays(planCode, body?.trialPeriodDays);
    const firstMonthPercentOff = normalizeFirstMonthPercentOff(body?.firstMonthPercentOff);
    const bankHoldAmountCents =
      planCode === "segna_x" && body?.bankHold === true ? SEGNAX_BANK_HOLD_AMOUNT_CENTS : undefined;
    const wantsPaymentSheet = body?.paymentUi === "payment_sheet" || body?.paymentUi === "native";

    const admin = createSupabaseAdminClient() as any;
    const { user, error: userError } = await resolveRequestUser(request);

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const [{ data: memberRow }, { data: profileRow }] = await Promise.all([
      admin.from("users").select("phone").eq("id", user.id).maybeSingle(),
      admin.from("user_profiles").select("profile_data").eq("user_id", user.id).maybeSingle(),
    ]);
    const profileData = ((profileRow?.profile_data ?? {}) as Record<string, unknown>) ?? {};
    const phoneReady = isPhoneVerified({
      usersPhone: typeof memberRow?.phone === "string" ? memberRow.phone : null,
      profilePhoneE164: typeof profileData.phone_e164 === "string" ? profileData.phone_e164 : null,
      phoneCodeVerified: profileData.phone_code_verified === true,
      authPhone: typeof user.phone === "string" ? user.phone : null,
      phoneConfirmedAt: user.phone_confirmed_at ?? null,
    });
    if (!phoneReady) {
      return NextResponse.json(
        {
          message: "Confirme ton numéro de téléphone par SMS avant d’activer ton abonnement.",
          code: "phone_not_verified",
        },
        { status: 403 },
      );
    }

    const { data: activePriceRow, error: activePriceError } = await admin
      .from("billing_plan_prices")
      .select("stripe_price_id")
      .eq("provider", "stripe")
      .eq("plan_code", planCode)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activePriceError) {
      return NextResponse.json({ message: activePriceError.message }, { status: 500 });
    }
    // Env d’abord (prod live vs preview test), puis mapping DB.
    const resolvedPriceId =
      getFallbackPriceId(planCode) ??
      (typeof activePriceRow?.stripe_price_id === "string" ? activePriceRow.stripe_price_id.trim() : null);
    if (!resolvedPriceId) {
      const envHint = planCode === "segna_plus" ? "STRIPE_PRICE_SEGNA_PLUS" : "STRIPE_PRICE_SEGNA_X";
      return NextResponse.json(
        { message: `Aucun prix Stripe actif pour ce plan. Configure billing_plan_prices ou la variable ${envHint}.` },
        { status: 400 },
      );
    }

    const config = getStripeConfig();
    const stripe = new Stripe(config.secretKey);

    let stripeCustomerId: string;
    try {
      stripeCustomerId = await ensureStripeBillingCustomer({
        stripe,
        admin,
        userId: user.id,
        email: user.email,
        source: "subscription_checkout",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de préparer le client Stripe.";
      return NextResponse.json({ message }, { status: 500 });
    }

    try {
      await syncStripeCustomerBillingAddressFromProfile({
        stripe,
        admin,
        userId: user.id,
        stripeCustomerId,
      });
    } catch (error) {
      // Non bloquant : Checkout reste possible sans préremplissage.
      console.warn("[stripe/subscription/checkout] sync billing address from profile", error);
    }

    let discountCouponId: string | undefined;
    if (firstMonthPercentOff != null) {
      try {
        discountCouponId = await resolveFirstMonthPercentOffCouponId(stripe, firstMonthPercentOff);
      } catch (error) {
        console.error("[stripe/subscription/checkout] first month coupon", error);
        return NextResponse.json(
          { message: "Impossible de préparer la remise 1er mois." },
          { status: 500 },
        );
      }
    }

    const subscriptionMetadata: Record<string, string> = {
      user_id: user.id,
      plan_code: planCode,
      ...(trialPeriodDays != null ? { checkout_trial_period_days: String(trialPeriodDays) } : {}),
      ...(firstMonthPercentOff != null
        ? { checkout_first_month_percent_off: String(firstMonthPercentOff) }
        : {}),
      ...(bankHoldAmountCents != null
        ? { bank_hold_amount_cents: String(bankHoldAmountCents) }
        : {}),
    };

    const frVatTaxRateId = resolveFrVat20TaxRateId();

    trackServerEvent(
      "subscription_checkout_started",
      { distinctId: user.id },
      {
        plan_code: planCode,
        ...(trialPeriodDays != null ? { trial_period_days: trialPeriodDays } : {}),
        ...(firstMonthPercentOff != null ? { first_month_percent_off: firstMonthPercentOff } : {}),
        ...(bankHoldAmountCents != null ? { bank_hold_amount_cents: bankHoldAmountCents } : {}),
        checkout_ui: wantsPaymentSheet ? "payment_sheet" : "hosted_checkout",
      },
    );

    /** Mobile in-app : Subscription incomplete + Payment Sheet (pas d’URL Checkout). */
    if (wantsPaymentSheet) {
      if (!config.publishableKey) {
        return NextResponse.json(
          { message: "STRIPE_PUBLISHABLE_KEY manquante côté serveur." },
          { status: 500 },
        );
      }

      await cancelIncompleteSubscriptionsForCustomer(stripe, stripeCustomerId);

      const subscription = await stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [
          {
            price: resolvedPriceId,
            ...(frVatTaxRateId ? { tax_rates: [frVatTaxRateId] } : {}),
          },
        ],
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
          payment_method_types: ["card"],
        },
        ...(discountCouponId ? { discounts: [{ coupon: discountCouponId }] } : {}),
        ...(trialPeriodDays != null ? { trial_period_days: trialPeriodDays } : {}),
        ...(frVatTaxRateId ? { default_tax_rates: [frVatTaxRateId] } : {}),
        metadata: subscriptionMetadata,
        expand: ["latest_invoice.confirmation_secret", "pending_setup_intent"],
      });

      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: stripeCustomerId },
        { apiVersion: STRIPE_EPHEMERAL_KEY_API_VERSION },
      );
      if (!ephemeralKey.secret) {
        return NextResponse.json(
          { message: "Stripe n'a pas renvoyé la clé éphémère Payment Sheet." },
          { status: 500 },
        );
      }

      const pendingSetup =
        typeof subscription.pending_setup_intent === "object" && subscription.pending_setup_intent
          ? subscription.pending_setup_intent
          : null;
      const setupIntentClientSecret = pendingSetup?.client_secret ?? null;
      const setupIntentId = pendingSetup?.id ?? null;

      const latestInvoice =
        typeof subscription.latest_invoice === "object" && subscription.latest_invoice
          ? subscription.latest_invoice
          : null;
      const confirmationSecret = latestInvoice?.confirmation_secret?.client_secret?.trim() || null;
      const paymentIntentClientSecret = setupIntentClientSecret ? null : confirmationSecret;
      const paymentIntentId = paymentIntentClientSecret
        ? paymentIntentIdFromClientSecret(paymentIntentClientSecret)
        : undefined;

      if (!setupIntentClientSecret && !paymentIntentClientSecret) {
        return NextResponse.json(
          {
            message:
              "Stripe n'a pas renvoyé de secret Payment Sheet pour cet abonnement. Réessaie ou contacte le support.",
          },
          { status: 500 },
        );
      }

      await flushServerAnalytics();

      return NextResponse.json({
        paymentUi: "payment_sheet",
        mode: setupIntentClientSecret ? "setup" : "payment",
        subscriptionId: subscription.id,
        ...(paymentIntentId ? { paymentIntentId } : {}),
        ...(paymentIntentClientSecret ? { paymentIntentClientSecret } : {}),
        ...(setupIntentId ? { setupIntentId } : {}),
        ...(setupIntentClientSecret ? { setupIntentClientSecret } : {}),
        customerId: stripeCustomerId,
        customerEphemeralKeySecret: ephemeralKey.secret,
        publishableKey: config.publishableKey,
      });
    }

    const cancelRaw = typeof body?.cancelReturnPath === "string" ? body.cancelReturnPath.trim() : "";
    const cancelUrl = resolveCancelUrl(cancelRaw, config.returnUrlBase);
    const mobileSuccessUrl = resolveMobileSuccessUrl(body?.mobileSuccessUrl);
    const websiteOrigin = getWebsiteOrigin();
    // Préférer l’origine réelle du cancel URL (ex. localhost:3002) pour le retour succès,
    // plutôt que seulement getWebsiteOrigin() — évite de renvoyer vers le mauvais port en local.
    let successWebsiteOrigin: string | null = null;
    try {
      const cancelParsed = new URL(cancelUrl);
      if (cancelParsed.pathname.startsWith("/abonnement")) {
        successWebsiteOrigin = cancelParsed.origin;
      }
    } catch {
      successWebsiteOrigin = null;
    }
    if (
      !successWebsiteOrigin &&
      (cancelUrl.startsWith(`${websiteOrigin}/`) || cancelUrl === websiteOrigin)
    ) {
      successWebsiteOrigin = websiteOrigin;
    }
    const successUrl =
      mobileSuccessUrl ??
      (successWebsiteOrigin
        ? `${successWebsiteOrigin}/abonnement/succes?session_id={CHECKOUT_SESSION_ID}&plan=${planCode}`
        : `${config.returnUrlBase}/api/stripe/subscription/sync?session_id={CHECKOUT_SESSION_ID}&plan=${planCode}`);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [
        {
          price: resolvedPriceId,
          quantity: 1,
          ...(frVatTaxRateId ? { tax_rates: [frVatTaxRateId] } : {}),
        },
      ],
      // Pas de formulaire adresse Checkout (abonnement) : l’adresse profil est déjà
      // sur le customer Stripe pour la facture + TVA.
      customer_update: {
        address: "auto",
        name: "auto",
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Stripe : `discounts` et `allow_promotion_codes` sont mutuellement exclusifs.
      ...(discountCouponId
        ? { discounts: [{ coupon: discountCouponId }] }
        : { allow_promotion_codes: true }),
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        plan_code: planCode,
        ...(bankHoldAmountCents != null
          ? { bank_hold_amount_cents: String(bankHoldAmountCents) }
          : {}),
        ...(firstMonthPercentOff != null
          ? { checkout_first_month_percent_off: String(firstMonthPercentOff) }
          : {}),
      },
      subscription_data: {
        metadata: subscriptionMetadata,
        ...(trialPeriodDays != null ? { trial_period_days: trialPeriodDays } : {}),
        // Renouvellements : même TVA sur les factures suivantes.
        ...(frVatTaxRateId ? { default_tax_rates: [frVatTaxRateId] } : {}),
      },
    });

    if (!session.url) {
      return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL de paiement." }, { status: 500 });
    }

    await flushServerAnalytics();

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer le paiement de l'abonnement.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
