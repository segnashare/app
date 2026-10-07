import type Stripe from "stripe";

/** 2 mois à 40 € + 1 mois offert, payés d’un coup. */
export const SEGNA_X_3_MONTH_AMOUNT_CENTS = 8000;
export const SEGNA_X_3_MONTH_LOOKUP_KEY = "segna_x_3_month_eur_80_ttc";

export type BillingTerm = "monthly" | "3_month";

export function isThreeMonthPriceMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as { billing_term?: unknown }).billing_term === "3_month";
}

/**
 * Anciens clients envoyaient `trialPeriodDays: 30` pour « 1 mois offert ».
 * Ce n’est pas un essai Stripe : c’est le pack 3 mois à 80 €.
 */
export function normalizeSubscriptionBillingTerm(body: {
  billingTerm?: unknown;
  trialPeriodDays?: unknown;
} | null): BillingTerm {
  const explicit = typeof body?.billingTerm === "string" ? body.billingTerm.trim() : "";
  if (explicit === "3_month") return "3_month";
  if (body?.trialPeriodDays != null && String(body.trialPeriodDays).trim() !== "") {
    return "3_month";
  }
  return "monthly";
}

export async function resolveSegnaXThreeMonthPriceId(params: {
  stripe: Stripe;
  admin: {
    from: (table: string) => any;
  };
  monthlyPriceId: string;
}): Promise<string> {
  const fromEnv = process.env.STRIPE_PRICE_SEGNA_X_3_MONTH?.trim() ?? "";
  if (fromEnv) return fromEnv;

  const { data: rows } = await params.admin
    .from("billing_plan_prices")
    .select("stripe_price_id, metadata")
    .eq("provider", "stripe")
    .eq("plan_code", "segna_x")
    .eq("is_active", true);

  const cached = (Array.isArray(rows) ? rows : []).find((row) => isThreeMonthPriceMetadata(row?.metadata));
  const cachedId = typeof cached?.stripe_price_id === "string" ? cached.stripe_price_id.trim() : "";
  if (cachedId) return cachedId;

  const listed = await params.stripe.prices.list({
    lookup_keys: [SEGNA_X_3_MONTH_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  let price = listed.data[0] ?? null;

  if (!price) {
    const monthly = await params.stripe.prices.retrieve(params.monthlyPriceId);
    const productId = typeof monthly.product === "string" ? monthly.product : monthly.product?.id;
    if (!productId) {
      throw new Error("Produit Stripe mensuel introuvable pour l’offre 3 mois.");
    }
    try {
      price = await params.stripe.prices.create({
        currency: "eur",
        unit_amount: SEGNA_X_3_MONTH_AMOUNT_CENTS,
        recurring: { interval: "month", interval_count: 3 },
        product: productId,
        tax_behavior: "inclusive",
        lookup_key: SEGNA_X_3_MONTH_LOOKUP_KEY,
        nickname: "SegnaX — 3 mois 80 € TTC",
        metadata: { plan_code: "segna_x", billing_term: "3_month" },
      });
    } catch (error) {
      const retry = await params.stripe.prices.list({
        lookup_keys: [SEGNA_X_3_MONTH_LOOKUP_KEY],
        limit: 1,
      });
      price = retry.data[0] ?? null;
      if (!price) throw error;
    }
  }

  const productId = typeof price.product === "string" ? price.product : null;
  await params.admin.from("billing_plan_prices").upsert(
    {
      provider: "stripe",
      plan_code: "segna_x",
      stripe_product_id: productId,
      stripe_price_id: price.id,
      monthly_included_orders: 1,
      monthly_consumption_points_grant: 400,
      is_active: true,
      metadata: {
        amount_eur_ttc: 80,
        billing_term: "3_month",
        interval_count: 3,
        lookup_key: SEGNA_X_3_MONTH_LOOKUP_KEY,
      },
    },
    { onConflict: "stripe_price_id" },
  );

  return price.id;
}
