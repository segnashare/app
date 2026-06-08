import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

async function resolvePaymentMethodFromLatestCartOrder(
  stripe: Stripe,
  admin: SupabaseClient,
  userId: string,
  customerId: string,
): Promise<string | null> {
  const { data: invoiceRow } = await admin
    .from("cart_order_stripe_invoices")
    .select("payment_intent_id")
    .eq("user_id", userId)
    .not("payment_intent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const paymentIntentId = String(
    (invoiceRow as { payment_intent_id?: string | null } | null)?.payment_intent_id ?? "",
  ).trim();
  if (!paymentIntentId) return null;

  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const pm = pi.payment_method;
    const paymentMethodId =
      typeof pm === "string" ? pm.trim() : pm && typeof pm === "object" ? String(pm.id).trim() : "";
    if (!paymentMethodId) return null;

    const existing = await stripe.paymentMethods.retrieve(paymentMethodId);
    const attached =
      typeof existing.customer === "string"
        ? existing.customer
        : existing.customer && typeof existing.customer === "object"
          ? existing.customer.id
          : null;
    if (!attached) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } else if (attached !== customerId) {
      return null;
    }

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    return paymentMethodId;
  } catch {
    return null;
  }
}

export async function resolveStripeCustomerPaymentMethod(
  stripe: Stripe,
  admin: SupabaseClient,
  userId: string,
): Promise<
  | { ok: true; customerId: string; paymentMethodId: string }
  | { ok: false; error: string }
> {
  const { data: billingRow } = await admin
    .from("billing_customers")
    .select("provider_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  const customerId =
    typeof (billingRow as { provider_customer_id?: string } | null)?.provider_customer_id === "string"
      ? (billingRow as { provider_customer_id: string }).provider_customer_id.trim()
      : "";
  if (!customerId) {
    return { ok: false, error: "no_billing_customer" };
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    return { ok: false, error: "customer_deleted" };
  }

  const defaultPm = customer.invoice_settings?.default_payment_method;
  let paymentMethodId =
    typeof defaultPm === "string" ? defaultPm : defaultPm && typeof defaultPm === "object" ? defaultPm.id : null;

  if (!paymentMethodId) {
    const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    paymentMethodId = pms.data[0]?.id ?? null;
  }

  if (!paymentMethodId) {
    paymentMethodId = await resolvePaymentMethodFromLatestCartOrder(stripe, admin, userId, customerId);
  }

  if (!paymentMethodId) {
    return { ok: false, error: "no_payment_method" };
  }

  return { ok: true, customerId, paymentMethodId };
}

export async function stripeCustomerHasSavedPaymentMethod(
  stripe: Stripe,
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const resolved = await resolveStripeCustomerPaymentMethod(stripe, admin, userId);
  return resolved.ok;
}
