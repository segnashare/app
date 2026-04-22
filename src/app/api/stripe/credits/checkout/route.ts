import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type WalletCreditKind, walletCreditKindForBillingSubscription } from "@/lib/wallet/credit-kind";

/** Packs catalogue « Obtenir plus » — alignés sur les prix Stripe (STRIPE_PRICE_CREDITS_*). */
export const CREDIT_PACK_AMOUNTS = [200, 500, 1000] as const;
export type CreditPackAmount = (typeof CREDIT_PACK_AMOUNTS)[number];

function isCreditPackAmount(value: unknown): value is CreditPackAmount {
  return typeof value === "number" && Number.isInteger(value) && (CREDIT_PACK_AMOUNTS as readonly number[]).includes(value);
}

async function resolvePriceIdFromEnvKey(stripe: Stripe, envKey: string): Promise<string | null> {
  const rawValue = process.env[envKey]?.trim() ?? "";
  if (!rawValue) return null;

  if (rawValue.startsWith("price_")) return rawValue;

  if (rawValue.startsWith("prod_")) {
    const prices = await stripe.prices.list({
      product: rawValue,
      active: true,
      limit: 1,
    });
    return prices.data[0]?.id ?? null;
  }

  return null;
}

function envKeyForCreditPack(pack: CreditPackAmount): string {
  return `STRIPE_PRICE_CREDITS_${pack}`;
}

/**
 * Achat pack de crédits (profil « Obtenir plus »).
 * Body : `{ "pack": 200 | 500 | 1000 }` — crédits d’échange (plus liés au seul abonnement).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { pack?: unknown; creditKind?: unknown } | null;
    const pack = body?.pack;

    if (!isCreditPackAmount(pack)) {
      return NextResponse.json({ message: "Pack invalide (200, 500 ou 1000 crédits)." }, { status: 400 });
    }

    const supabase = (await createSupabaseServerClient()) as any;
    const admin = createSupabaseAdminClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const creditsKind: WalletCreditKind = walletCreditKindForBillingSubscription(null, null);

    const config = getStripeConfig();
    const stripe = new Stripe(config.secretKey);

    const envKey = envKeyForCreditPack(pack);
    const priceId = await resolvePriceIdFromEnvKey(stripe, envKey);
    if (!priceId) {
      return NextResponse.json(
        { message: `Price introuvable pour ${envKey}. Définis un price_… ou prod_… dans .env.local.` },
        { status: 400 },
      );
    }

    const { data: billingCustomerRow } = await admin
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("provider", "stripe")
      .eq("user_id", user.id)
      .maybeSingle();

    let stripeCustomerId = billingCustomerRow?.provider_customer_id ?? null;
    if (!stripeCustomerId) {
      const createdCustomer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          user_id: user.id,
        },
      });
      stripeCustomerId = createdCustomer.id;

      await admin.from("billing_customers").upsert(
        {
          user_id: user.id,
          provider: "stripe",
          provider_customer_id: stripeCustomerId,
          metadata: {
            source: "credits_checkout",
          },
        },
        { onConflict: "user_id" },
      );
    }

    const successUrl = `${config.returnUrlBase}/api/stripe/credits/sync?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.returnUrlBase}/profile?tab=plus&credits=cancelled&kind=${creditsKind}&pack=${pack}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: user.id,
      metadata: {
        checkout_kind: "credits_purchase",
        credits_kind: creditsKind,
        credits_amount: String(pack),
        user_id: user.id,
      },
    });

    if (!session.url) {
      return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL de paiement." }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer le paiement des crédits.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
