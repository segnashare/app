import type Stripe from "stripe";

/**
 * Retourne un `customer` Stripe valide pour l’utilisateur.
 * Si l’ID en base pointe vers un autre compte Stripe (test/live) ou un client
 * supprimé → recrée le customer et met à jour `billing_customers`.
 */
export async function ensureStripeBillingCustomer(params: {
  stripe: Stripe;
  admin: any;
  userId: string;
  email?: string | null;
  source: string;
}): Promise<string> {
  const { stripe, admin, userId, email, source } = params;

  const { data: billingCustomerRow, error: billingCustomerError } = await admin
    .from("billing_customers")
    .select("provider_customer_id")
    .eq("provider", "stripe")
    .eq("user_id", userId)
    .maybeSingle();

  if (billingCustomerError) {
    throw new Error(billingCustomerError.message);
  }

  let stripeCustomerId =
    typeof billingCustomerRow?.provider_customer_id === "string"
      ? billingCustomerRow.provider_customer_id.trim()
      : "";

  if (stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(stripeCustomerId);
      if (!existing.deleted) {
        return stripeCustomerId;
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      const message = error instanceof Error ? error.message : "";
      // resource_missing / "No such customer" → recréer
      if (code !== "resource_missing" && !message.includes("No such customer")) {
        throw error;
      }
    }
    stripeCustomerId = "";
  }

  const createdCustomer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: {
      user_id: userId,
    },
  });
  stripeCustomerId = createdCustomer.id;

  const { error: upsertCustomerError } = await admin.from("billing_customers").upsert(
    {
      user_id: userId,
      provider: "stripe",
      provider_customer_id: stripeCustomerId,
      metadata: {
        source,
        recreated_missing_customer: true,
      },
    },
    { onConflict: "user_id" },
  );
  if (upsertCustomerError) {
    throw new Error(upsertCustomerError.message);
  }

  return stripeCustomerId;
}
