import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getWebsiteOrigin } from "@/lib/auth/website-checkout-onboarding";
import { fetchUserKycVerified } from "@/lib/kyc/user-kyc-verified";
import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
import { getStripeConfig } from "@/lib/social/stripe";
import { ensureStripeBillingCustomer } from "@/lib/stripe/ensure-billing-customer";
import { SEGNAX_BANK_HOLD_AMOUNT_CENTS } from "@/lib/stripe/segnax-subscription-bank-hold";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

type PlanCode = "segna_plus" | "segna_x";

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
  const key = planCode === "segna_plus" ? process.env.STRIPE_PRICE_SEGNA_PLUS : process.env.STRIPE_PRICE_SEGNA_X;
  const value = key?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function resolveCancelUrl(cancelRaw: string, returnUrlBase: string): string {
  const websiteOrigin = getWebsiteOrigin();
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      planCode?: unknown;
      cancelReturnPath?: unknown;
      trialPeriodDays?: unknown;
      /** Empreinte bancaire SegnaX (100 €) après validation carte. */
      bankHold?: unknown;
    } | null;
    const planCode = body?.planCode;
    if (!isPlanCode(planCode)) {
      return NextResponse.json({ message: "Plan invalide." }, { status: 400 });
    }
    const trialPeriodDays = normalizeSubscriptionTrialPeriodDays(planCode, body?.trialPeriodDays);
    const bankHoldAmountCents =
      planCode === "segna_x" && body?.bankHold === true ? SEGNAX_BANK_HOLD_AMOUNT_CENTS : undefined;

    const admin = createSupabaseAdminClient() as any;
    const { user, error: userError } = await resolveRequestUser(request);

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    if (!(await fetchUserKycVerified(admin, user.id))) {
      return NextResponse.json(
        {
          message: "La vérification d’identité (KYC) est obligatoire avant de souscrire à un abonnement.",
          code: "kyc_required",
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
    const resolvedPriceId = activePriceRow?.stripe_price_id ?? getFallbackPriceId(planCode);
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

    const cancelRaw = typeof body?.cancelReturnPath === "string" ? body.cancelReturnPath.trim() : "";
    const cancelUrl = resolveCancelUrl(cancelRaw, config.returnUrlBase);
    const websiteOrigin = getWebsiteOrigin();
    const successFromWebsite =
      cancelUrl.startsWith(`${websiteOrigin}/`) || cancelUrl === websiteOrigin;
    const successUrl = successFromWebsite
      ? `${websiteOrigin}/abonnement/succes?session_id={CHECKOUT_SESSION_ID}&plan=${planCode}`
      : `${config.returnUrlBase}/api/stripe/subscription/sync?session_id={CHECKOUT_SESSION_ID}&plan=${planCode}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [
        {
          price: resolvedPriceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        plan_code: planCode,
        ...(bankHoldAmountCents != null
          ? { bank_hold_amount_cents: String(bankHoldAmountCents) }
          : {}),
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_code: planCode,
          ...(trialPeriodDays != null ? { checkout_trial_period_days: String(trialPeriodDays) } : {}),
          ...(bankHoldAmountCents != null
            ? { bank_hold_amount_cents: String(bankHoldAmountCents) }
            : {}),
        },
        ...(trialPeriodDays != null ? { trial_period_days: trialPeriodDays } : {}),
      },
    });

    if (!session.url) {
      return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL de paiement." }, { status: 500 });
    }

    trackServerEvent(
      "subscription_checkout_started",
      { distinctId: user.id },
      {
        plan_code: planCode,
        ...(trialPeriodDays != null ? { trial_period_days: trialPeriodDays } : {}),
        ...(bankHoldAmountCents != null ? { bank_hold_amount_cents: bankHoldAmountCents } : {}),
      },
    );
    await flushServerAnalytics();

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer le paiement de l'abonnement.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
