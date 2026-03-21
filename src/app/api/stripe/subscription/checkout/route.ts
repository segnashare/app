import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PlanCode = "segna_plus" | "segna_x";

function isPlanCode(value: unknown): value is PlanCode {
  return value === "segna_plus" || value === "segna_x";
}

function toPackageMode(planCode: PlanCode): "plus" | "minus" {
  return planCode === "segna_x" ? "minus" : "plus";
}

function getFallbackPriceId(planCode: PlanCode): string | null {
  const key = planCode === "segna_plus" ? process.env.STRIPE_PRICE_SEGNA_PLUS : process.env.STRIPE_PRICE_SEGNA_X;
  const value = key?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { planCode?: unknown } | null;
    const planCode = body?.planCode;
    if (!isPlanCode(planCode)) {
      return NextResponse.json({ message: "Plan invalide." }, { status: 400 });
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

    const { data: billingCustomerRow, error: billingCustomerError } = await admin
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("provider", "stripe")
      .eq("user_id", user.id)
      .maybeSingle();

    if (billingCustomerError) {
      return NextResponse.json({ message: billingCustomerError.message }, { status: 500 });
    }

    let stripeCustomerId = billingCustomerRow?.provider_customer_id ?? null;
    if (!stripeCustomerId) {
      const createdCustomer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          user_id: user.id,
        },
      });
      stripeCustomerId = createdCustomer.id;

      const { error: upsertCustomerError } = await admin.from("billing_customers").upsert(
        {
          user_id: user.id,
          provider: "stripe",
          provider_customer_id: stripeCustomerId,
          metadata: {
            source: "subscription_checkout",
          },
        },
        { onConflict: "user_id" },
      );
      if (upsertCustomerError) {
        return NextResponse.json({ message: upsertCustomerError.message }, { status: 500 });
      }
    }

    const successUrl = `${config.returnUrlBase}/api/stripe/subscription/sync?session_id={CHECKOUT_SESSION_ID}&plan=${planCode}`;
    const cancelUrl = `${config.returnUrlBase}/package?plan=${toPackageMode(planCode)}&checkout=cancelled`;

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
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_code: planCode,
        },
      },
    });

    if (!session.url) {
      return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL de paiement." }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer le paiement de l'abonnement.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
