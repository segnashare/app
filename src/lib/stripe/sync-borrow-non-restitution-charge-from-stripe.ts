import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";

type ChargeRow = {
  id: string;
  status?: string;
  stripe_invoice_id?: string | null;
  stripe_invoice_hosted_url?: string | null;
  overdue_id?: string;
};

/**
 * Si la facture Stripe est payée mais le webhook n'a pas encore synchronisé la base,
 * met à jour charge + overdue (aligné sur borrow-non-restitution-invoice-webhook).
 */
export async function syncBorrowNonRestitutionChargeFromStripe(
  admin: SupabaseClient,
  chargeRow: ChargeRow | null,
): Promise<{ paid: boolean; hostedInvoiceUrl: string | null }> {
  if (!chargeRow?.id) {
    return { paid: false, hostedInvoiceUrl: null };
  }

  const hostedUrl = String(chargeRow.stripe_invoice_hosted_url ?? "").trim() || null;

  if (String(chargeRow.status ?? "").toLowerCase() === "succeeded") {
    return { paid: true, hostedInvoiceUrl: hostedUrl };
  }

  const invoiceId = String(chargeRow.stripe_invoice_id ?? "").trim();
  if (!invoiceId || invoiceId.startsWith("dry_run_")) {
    return { paid: false, hostedInvoiceUrl: hostedUrl };
  }

  let stripe: Stripe;
  try {
    stripe = new Stripe(getStripeConfig().secretKey);
  } catch {
    return { paid: false, hostedInvoiceUrl: hostedUrl };
  }

  let invoice: Stripe.Invoice;
  try {
    invoice = await stripe.invoices.retrieve(invoiceId);
  } catch (e) {
    console.warn("[borrow-non-restitution] sync retrieve", invoiceId, e);
    return { paid: false, hostedInvoiceUrl: hostedUrl };
  }

  if (invoice.metadata?.source !== "borrow_non_restitution") {
    return { paid: false, hostedInvoiceUrl: hostedUrl };
  }

  const refreshedHostedUrl = invoice.hosted_invoice_url ?? hostedUrl;
  const nowIso = new Date().toISOString();

  if (invoice.status === "paid") {
    await admin
      .from("cart_borrow_non_restitution_charges")
      .update({
        status: "succeeded",
        stripe_invoice_hosted_url: refreshedHostedUrl,
        failure_code: null,
      })
      .eq("id", chargeRow.id);

    if (chargeRow.overdue_id) {
      await admin
        .from("cart_borrow_overdue")
        .update({
          recovery_phase: "non_restitution_charged",
          non_restitution_invoice_id: invoiceId,
          updated_at: nowIso,
        })
        .eq("id", chargeRow.overdue_id);
    }

    return { paid: true, hostedInvoiceUrl: refreshedHostedUrl };
  }

  if (refreshedHostedUrl && refreshedHostedUrl !== hostedUrl) {
    await admin
      .from("cart_borrow_non_restitution_charges")
      .update({ stripe_invoice_hosted_url: refreshedHostedUrl })
      .eq("id", chargeRow.id);
  }

  return { paid: false, hostedInvoiceUrl: refreshedHostedUrl };
}
