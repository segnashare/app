import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { processItemDisputeStripeInvoiceEvent } from "@/lib/stripe/item-dispute-invoice-webhook";
import { getStripeConfig } from "@/lib/social/stripe";

type Resolution = Record<string, unknown>;

/**
 * Si la facture Stripe est payée mais le webhook n’a pas encore synchronisé,
 * applique `invoice.paid` (resolve pièce + clôture panier si toutes les pièces OK).
 */
export async function syncItemDisputeInvoiceFromStripe(
  admin: SupabaseClient,
  input: {
    itemDisputeId: string;
    status?: string | null;
    resolution?: unknown;
  },
): Promise<{ paid: boolean; synced: boolean }> {
  const itemDisputeId = input.itemDisputeId.trim();
  if (!itemDisputeId) return { paid: false, synced: false };

  const prev: Resolution =
    input.resolution && typeof input.resolution === "object" && !Array.isArray(input.resolution)
      ? { ...(input.resolution as Resolution) }
      : {};

  if (String(prev.chargeStatus ?? "").toLowerCase() === "paid") {
    return { paid: true, synced: false };
  }
  if (String(input.status ?? "").toLowerCase() === "resolved" && String(prev.chargeStatus ?? "") === "paid") {
    return { paid: true, synced: false };
  }

  const invoiceId = String(prev.stripeInvoiceId ?? "").trim();
  if (!invoiceId || invoiceId.startsWith("dry_run_")) {
    return { paid: false, synced: false };
  }

  let stripe: Stripe;
  try {
    stripe = new Stripe(getStripeConfig().secretKey);
  } catch {
    return { paid: false, synced: false };
  }

  let invoice: Stripe.Invoice;
  try {
    invoice = await stripe.invoices.retrieve(invoiceId);
  } catch (e) {
    console.warn(
      "[item-dispute] sync retrieve",
      invoiceId,
      e instanceof Error ? e.message : String(e),
    );
    return { paid: false, synced: false };
  }

  // Filet : metadata absente sur certains events → on la réinjecte depuis la DB.
  if (!invoice.metadata?.item_dispute_id) {
    invoice = {
      ...invoice,
      metadata: {
        ...(invoice.metadata ?? {}),
        source: "item_dispute",
        item_dispute_id: itemDisputeId,
      },
    };
  }

  if (invoice.status !== "paid") {
    return { paid: false, synced: false };
  }

  const result = await processItemDisputeStripeInvoiceEvent(admin, invoice, "invoice.paid");
  return { paid: true, synced: result === "processed" };
}

/**
 * Synchronise toutes les factures litige pièce encore `invoiced`/`failed`/`recorded`
 * pour une liste de litiges panier (filet webhook).
 */
export async function syncUnpaidItemDisputeInvoicesForCartDisputes(
  admin: SupabaseClient,
  cartDisputeIds: string[],
): Promise<number> {
  const ids = [...new Set(cartDisputeIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;

  const { data: rows } = await admin
    .from("item_disputes")
    .select("id, status, resolution")
    .in("cart_dispute_id", ids)
    .is("deleted_at", null)
    .in("status", ["open", "in_review"])
    .limit(40);

  let synced = 0;
  for (const row of rows ?? []) {
    const resolution =
      row.resolution && typeof row.resolution === "object" && !Array.isArray(row.resolution)
        ? (row.resolution as Resolution)
        : null;
    if (!resolution) continue;
    const charge = String(resolution.chargeStatus ?? "").toLowerCase();
    if (charge !== "invoiced" && charge !== "failed" && charge !== "recorded") continue;
    if (!String(resolution.stripeInvoiceId ?? "").trim()) continue;

    const result = await syncItemDisputeInvoiceFromStripe(admin, {
      itemDisputeId: String(row.id),
      status: typeof row.status === "string" ? row.status : null,
      resolution,
    });
    if (result.synced) synced += 1;
  }
  return synced;
}
