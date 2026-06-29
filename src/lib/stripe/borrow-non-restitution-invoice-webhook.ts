import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

type ChargeRow = {
  id: string;
  cart_id: string;
  overdue_id: string;
  status: string;
};

async function loadChargeByInvoiceId(
  admin: SupabaseClient,
  invoiceId: string,
): Promise<ChargeRow | null> {
  const { data, error } = await admin
    .from("cart_borrow_non_restitution_charges")
    .select("id,cart_id,overdue_id,status")
    .eq("stripe_invoice_id", invoiceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ChargeRow | null) ?? null;
}

function isBorrowNonRestitutionInvoice(invoice: Stripe.Invoice): boolean {
  return invoice.metadata?.source === "borrow_non_restitution";
}

/**
 * Webhooks Stripe Billing : invoice.paid | payment_failed | marked_uncollectible.
 * Smart Retries gérés côté Stripe — pas de cron retry Segna.
 */
export async function processBorrowNonRestitutionStripeInvoiceEvent(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
  eventType: string,
): Promise<"processed" | "ignored"> {
  if (!isBorrowNonRestitutionInvoice(invoice)) return "ignored";

  const invoiceId = invoice.id;
  const charge = await loadChargeByInvoiceId(admin, invoiceId);
  if (!charge) {
    console.warn("[borrow-non-restitution] webhook charge not found", invoiceId, eventType);
    return "ignored";
  }

  const nowIso = new Date().toISOString();
  const hostedUrl = invoice.hosted_invoice_url ?? null;
  const failureCode = invoice.last_finalization_error?.message ?? null;

  if (eventType === "invoice.paid") {
    await admin
      .from("cart_borrow_non_restitution_charges")
      .update({
        status: "succeeded",
        stripe_invoice_hosted_url: hostedUrl,
        failure_code: null,
      })
      .eq("id", charge.id);

    await admin
      .from("cart_borrow_overdue")
      .update({
        recovery_phase: "non_restitution_charged",
        non_restitution_invoice_id: invoiceId,
        updated_at: nowIso,
      })
      .eq("id", charge.overdue_id);

    return "processed";
  }

  if (eventType === "invoice.payment_failed") {
    await admin
      .from("cart_borrow_non_restitution_charges")
      .update({
        status: "pending",
        stripe_invoice_hosted_url: hostedUrl,
        failure_code: failureCode,
      })
      .eq("id", charge.id);

    return "processed";
  }

  if (eventType === "invoice.marked_uncollectible") {
    await admin
      .from("cart_borrow_non_restitution_charges")
      .update({
        status: "failed",
        stripe_invoice_hosted_url: hostedUrl,
        failure_code: failureCode ?? "uncollectible",
      })
      .eq("id", charge.id);

    await admin
      .from("cart_borrow_overdue")
      .update({
        recovery_phase: "collection",
        recovery_status: "collection",
        updated_at: nowIso,
      })
      .eq("id", charge.overdue_id);

    return "processed";
  }

  if (eventType === "invoice.finalized") {
    await admin
      .from("cart_borrow_non_restitution_charges")
      .update({
        stripe_invoice_hosted_url: hostedUrl,
      })
      .eq("id", charge.id);

    return "processed";
  }

  return "ignored";
}
