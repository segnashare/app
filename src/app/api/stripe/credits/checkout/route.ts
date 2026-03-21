import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CreditKind = "pods" | "mods";
type MembershipTier = "guest" | "segna_plus" | "segna_x";

function isCreditKind(value: unknown): value is CreditKind {
  return value === "pods" || value === "mods";
}

function isValidPack(creditKind: CreditKind, pack: unknown): pack is number {
  if (typeof pack !== "number" || !Number.isInteger(pack)) return false;
  if (creditKind === "pods") return pack === 20 || pack === 50 || pack === 100;
  return pack === 10 || pack === 20 || pack === 50;
}

function getUserMembershipTier(planCode: string | null | undefined, status: string | null | undefined): MembershipTier {
  const normalizedPlan = (planCode ?? "").toLowerCase();
  const normalizedStatus = (status ?? "").toLowerCase();
  const isActive = normalizedStatus === "active" || normalizedStatus === "trialing";
  if (!isActive) return "guest";
  if (normalizedPlan === "segna_x") return "segna_x";
  if (normalizedPlan === "segna_plus") return "segna_plus";
  return "guest";
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

function envKeyForPack(creditKind: CreditKind, pack: number): string {
  if (creditKind === "pods") return `STRIPE_PRICE_PODS_${pack}`;
  return `STRIPE_PRICE_MODS_${pack}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { creditKind?: unknown; pack?: unknown } | null;
    const creditKind = body?.creditKind;
    const pack = body?.pack;

    if (!isCreditKind(creditKind) || !isValidPack(creditKind, pack)) {
      return NextResponse.json({ message: "Pack invalide." }, { status: 400 });
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

    const { data: subscriptionRow } = await admin
      .from("user_subscriptions")
      .select("plan_code,status")
      .eq("user_id", user.id)
      .eq("provider", "stripe")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const membershipTier = getUserMembershipTier(subscriptionRow?.plan_code ?? null, subscriptionRow?.status ?? null);
    const expectedKind: CreditKind = membershipTier === "guest" ? "pods" : "mods";
    if (creditKind !== expectedKind) {
      return NextResponse.json({ message: "Produit indisponible pour ce statut d'abonnement." }, { status: 403 });
    }

    const config = getStripeConfig();
    const stripe = new Stripe(config.secretKey);

    const envKey = envKeyForPack(creditKind, pack);
    const priceId = await resolvePriceIdFromEnvKey(stripe, envKey);
    if (!priceId) {
      return NextResponse.json({ message: `Price introuvable pour ${envKey}. Utilise un price_... ou prod_... valide.` }, { status: 400 });
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
    const cancelUrl = `${config.returnUrlBase}/profile?tab=plus&credits=cancelled&kind=${creditKind}&pack=${pack}`;

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
        credits_kind: creditKind,
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
