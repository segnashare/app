import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getWebsiteOrigin } from "@/lib/auth/website-checkout-onboarding";
import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
import { getStripeConfig } from "@/lib/social/stripe";
import { ensureStripeBillingCustomer } from "@/lib/stripe/ensure-billing-customer";
import { resolveFrVat20TaxRateId } from "@/lib/stripe/fr-vat-tax-rate";
import { SEGNAX_BANK_HOLD_AMOUNT_CENTS } from "@/lib/stripe/segnax-subscription-bank-hold";
import {
  isAppleReviewCompCheckoutEmail,
  resolveAppleReviewCompCouponId,
} from "@/lib/stripe/apple-review-comp-checkout";
import {
  isThreeMonthPriceMetadata,
  normalizeSubscriptionBillingTerm,
  resolveSegnaXThreeMonthPriceId,
} from "@/lib/stripe/resolve-segna-x-three-month-price";
import {
  normalizeFirstMonthPercentOff,
  resolveFirstMonthPercentOffCouponId,
} from "@/lib/stripe/subscription-first-month-coupon";
import { upsertSubscriptionAndEntitlements } from "@/lib/stripe/subscription-state";
import { syncStripeCustomerBillingAddressFromProfile } from "@/lib/stripe/sync-customer-billing-address-from-profile";
import { isPhoneVerified } from "@/lib/phone/phone-verified";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

type PlanCode = "segna_plus" | "segna_x";

const STRIPE_EPHEMERAL_KEY_API_VERSION = "2026-02-25.clover" as const;

function isPlanCode(value: unknown): value is PlanCode {
  return value === "segna_plus" || value === "segna_x";
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
      /** Pack 3 mois / 80 € (2 mois achetés + 1 offert). Pas un essai Stripe. */
      billingTerm?: unknown;
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
    const billingTerm = normalizeSubscriptionBillingTerm(body);
    const requestedFirstMonthOff = normalizeFirstMonthPercentOff(body?.firstMonthPercentOff);
    /** Offre −50 % 1er mois retirée : tarif plein (les anciens clients qui envoient encore 50 sont ignorés). */
    const firstMonthPercentOff = requestedFirstMonthOff === 50 ? undefined : requestedFirstMonthOff;
    const wantsPaymentSheet = body?.paymentUi === "payment_sheet" || body?.paymentUi === "native";

    const admin = createSupabaseAdminClient() as any;
    const { user, error: userError } = await resolveRequestUser(request);

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    /** App Review (`review@…`) : abonnement offert au checkout, pas de SegnaX pré-attribué. */
    const appleReviewComp = isAppleReviewCompCheckoutEmail(user.email);
    const bankHoldAmountCents =
      !appleReviewComp && planCode === "segna_x" && body?.bankHold === true
        ? SEGNAX_BANK_HOLD_AMOUNT_CENTS
        : undefined;

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

    const { data: activePriceRows, error: activePriceError } = await admin
      .from("billing_plan_prices")
      .select("stripe_price_id, metadata")
      .eq("provider", "stripe")
      .eq("plan_code", planCode)
      .eq("is_active", true)
      .order("updated_at", { ascending: false });

    if (activePriceError) {
      return NextResponse.json({ message: activePriceError.message }, { status: 500 });
    }
    const monthlyPriceRow = (Array.isArray(activePriceRows) ? activePriceRows : []).find(
      (row) => !isThreeMonthPriceMetadata(row?.metadata),
    );
    // Env d’abord (prod live vs preview test), puis mapping DB mensuel.
    const monthlyPriceId =
      getFallbackPriceId(planCode) ??
      (typeof monthlyPriceRow?.stripe_price_id === "string" ? monthlyPriceRow.stripe_price_id.trim() : null);
    if (!monthlyPriceId) {
      const envHint = planCode === "segna_plus" ? "STRIPE_PRICE_SEGNA_PLUS" : "STRIPE_PRICE_SEGNA_X";
      return NextResponse.json(
        { message: `Aucun prix Stripe actif pour ce plan. Configure billing_plan_prices ou la variable ${envHint}.` },
        { status: 400 },
      );
    }

    const config = getStripeConfig();
    const stripe = new Stripe(config.secretKey);

    let resolvedPriceId = monthlyPriceId;
    if (billingTerm === "3_month") {
      if (planCode !== "segna_x") {
        return NextResponse.json({ message: "L’offre 3 mois n’est disponible que pour SegnaX." }, { status: 400 });
      }
      try {
        resolvedPriceId = await resolveSegnaXThreeMonthPriceId({
          stripe,
          admin,
          monthlyPriceId,
        });
      } catch (error) {
        console.error("[stripe/subscription/checkout] 3-month price", error);
        return NextResponse.json(
          { message: "Impossible de préparer l’offre 3 mois (80 €)." },
          { status: 500 },
        );
      }
    }

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
    if (appleReviewComp) {
      try {
        discountCouponId = await resolveAppleReviewCompCouponId(stripe);
      } catch (error) {
        console.error("[stripe/subscription/checkout] apple review coupon", error);
        return NextResponse.json(
          { message: "Impossible de préparer l’abonnement offert (review)." },
          { status: 500 },
        );
      }
    } else if (firstMonthPercentOff != null) {
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
      billing_term: billingTerm,
      ...(firstMonthPercentOff != null && !appleReviewComp
        ? { checkout_first_month_percent_off: String(firstMonthPercentOff) }
        : {}),
      ...(appleReviewComp ? { apple_review_comp: "1" } : {}),
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
        billing_term: billingTerm,
        ...(firstMonthPercentOff != null && !appleReviewComp
          ? { first_month_percent_off: firstMonthPercentOff }
          : {}),
        ...(appleReviewComp ? { apple_review_comp: true } : {}),
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

      /**
       * App Review : coupon 100 % forever → facture à 0 €.
       * Création « normale » (pas default_incomplete) pour activer tout de suite sans carte.
       */
      if (appleReviewComp && discountCouponId) {
        const subscription = await stripe.subscriptions.create({
          customer: stripeCustomerId,
          items: [
            {
              price: resolvedPriceId,
              ...(frVatTaxRateId ? { tax_rates: [frVatTaxRateId] } : {}),
            },
          ],
          ...(discountCouponId ? { discounts: [{ coupon: discountCouponId }] } : {}),
          ...(frVatTaxRateId ? { default_tax_rates: [frVatTaxRateId] } : {}),
          metadata: subscriptionMetadata,
        });

        if (subscription.status === "active" || subscription.status === "trialing") {
          try {
            await upsertSubscriptionAndEntitlements(admin, user.id, stripeCustomerId, subscription);
          } catch (error) {
            console.error("[stripe/subscription/checkout] apple review upsert", error);
            return NextResponse.json(
              { message: "Abonnement offert créé mais synchronisation échouée." },
              { status: 500 },
            );
          }
          await flushServerAnalytics();
          return NextResponse.json({
            paymentUi: "comp_activated",
            planCode,
            subscriptionId: subscription.id,
          });
        }
        // Si Stripe exige quand même un moyen de paiement, on retombe sur la Payment Sheet ci-dessous.
        console.warn(
          "[stripe/subscription/checkout] apple review sub not active",
          subscription.id,
          subscription.status,
        );
        await stripe.subscriptions.cancel(subscription.id).catch(() => undefined);
      }

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
        // $0 / déjà payé : activer localement si Stripe a déjà rendu l’abo actif.
        if (subscription.status === "active" || subscription.status === "trialing") {
          try {
            await upsertSubscriptionAndEntitlements(admin, user.id, stripeCustomerId, subscription);
          } catch (error) {
            console.error("[stripe/subscription/checkout] zero-amount upsert", error);
            return NextResponse.json(
              { message: "Abonnement créé mais synchronisation échouée." },
              { status: 500 },
            );
          }
          await flushServerAnalytics();
          return NextResponse.json({
            paymentUi: "comp_activated",
            planCode,
            subscriptionId: subscription.id,
          });
        }
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
        billing_term: billingTerm,
        ...(bankHoldAmountCents != null
          ? { bank_hold_amount_cents: String(bankHoldAmountCents) }
          : {}),
        ...(firstMonthPercentOff != null && !appleReviewComp
          ? { checkout_first_month_percent_off: String(firstMonthPercentOff) }
          : {}),
        ...(appleReviewComp ? { apple_review_comp: "1" } : {}),
      },
      subscription_data: {
        metadata: subscriptionMetadata,
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
