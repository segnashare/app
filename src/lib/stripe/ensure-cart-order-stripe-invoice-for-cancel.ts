import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { upsertCartOrderStripeInvoiceFromSession } from "@/lib/stripe/upsert-cart-order-stripe-invoice";

const INVOICE_SELECT =
  "amount_total_cents, payment_intent_id, checkout_session_id, credits_line_cents, service_ttc_cents, shipping_ttc_cents, fees_ttc_cents, fees_vat_cents, currency, created_at";

/** Rattrapage snapshot paiement Stripe avant annulation / remboursement. */
export async function ensureCartOrderStripeInvoiceForCancel(
  admin: SupabaseClient,
  cartId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data: inv } = await admin
    .from("cart_order_stripe_invoices")
    .select(INVOICE_SELECT)
    .eq("cart_id", cartId)
    .eq("user_id", userId)
    .maybeSingle();

  const invRow = inv as Record<string, unknown> | null;
  if (invRow && Math.trunc(Number(invRow.amount_total_cents ?? 0)) > 0) {
    return invRow;
  }

  const { data: debit } = await admin
    .from("wallet_transactions")
    .select("metadata")
    .eq("user_id", userId)
    .eq("kind", "debit")
    .eq("direction", "debit")
    .filter("metadata->>source", "eq", "cart_order_stripe")
    .filter("metadata->>cart_id", "eq", cartId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const meta = (debit as { metadata?: Record<string, unknown> } | null)?.metadata ?? {};
  const sessionId = String(meta.stripe_checkout_session_id ?? "").trim();
  if (!sessionId || sessionId === "wallet_only") {
    return invRow;
  }

  try {
    const stripe = new Stripe(getStripeConfig().secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return invRow;
    await upsertCartOrderStripeInvoiceFromSession(admin as never, session, userId);
    const { data: reloaded } = await admin
      .from("cart_order_stripe_invoices")
      .select(INVOICE_SELECT)
      .eq("cart_id", cartId)
      .eq("user_id", userId)
      .maybeSingle();
    return (reloaded as Record<string, unknown> | null) ?? invRow;
  } catch (e) {
    console.error("[ensureCartOrderStripeInvoiceForCancel]", cartId, e);
    return invRow;
  }
}
