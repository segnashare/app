import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { resolveCartDisputeWhenItemsTerminal } from "@/lib/disputes/resolve-cart-dispute-when-items-terminal";
import { NotificationKind } from "@/lib/notifications/kinds";
import { notifyItemDisputeInvoicePaid } from "@/lib/notifications/item-dispute-invoice-paid-notify";

type Resolution = Record<string, unknown>;

function facturationNotifyKind(defectTier: string | null | undefined): string | null {
  switch (String(defectTier ?? "").trim()) {
    case "minor":
      return NotificationKind.itemDisputeMinorWarning;
    case "small_irreversible":
      return NotificationKind.itemDisputeSmallDefectCharged;
    case "major_irreversible":
      return NotificationKind.itemDisputeMajorDefectCharged;
    case "non_return":
      return NotificationKind.itemDisputeNonReturnCharged;
    default:
      return null;
  }
}

/** True si la push « Facturation du litige » a déjà été journalisée. */
async function wasFacturationAlreadyNotified(
  admin: SupabaseClient,
  itemDisputeId: string,
  defectTier: string | null | undefined,
): Promise<boolean> {
  const kind = facturationNotifyKind(defectTier);
  if (!kind) return true;
  const keys = [`txn:${kind}:${itemDisputeId}`, `txn:${kind}:batch:${itemDisputeId}`];
  const { data } = await admin
    .from("notification_send_log")
    .select("idempotency_key")
    .in("idempotency_key", keys)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.idempotency_key);
}

async function resolveItemDisputeIdsFromInvoice(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<string[]> {
  const fromCsv = String(invoice.metadata?.item_dispute_ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromMeta = invoice.metadata?.item_dispute_id?.trim() ?? "";
  const seed = [...new Set([...fromCsv, ...(fromMeta ? [fromMeta] : [])])];

  const invoiceId = String(invoice.id ?? "").trim();
  if (invoiceId) {
    const { data } = await admin
      .from("item_disputes")
      .select("id")
      .contains("resolution", { stripeInvoiceId: invoiceId })
      .is("deleted_at", null)
      .limit(40);
    for (const row of data ?? []) {
      if (typeof row.id === "string" && row.id) seed.push(row.id);
    }
  }

  return [...new Set(seed)];
}

/**
 * Webhooks Stripe : invoice.paid | payment_failed | marked_uncollectible pour litige item.
 * @param options.skipNotify — maj DB sans push (ex. sync à la création facture : la notif
 *   « Litige clôturé » est envoyée ensuite, après « Facturation du litige »).
 */
export async function processItemDisputeStripeInvoiceEvent(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
  eventType: string,
  options?: { skipNotify?: boolean },
): Promise<"processed" | "ignored"> {
  const source = invoice.metadata?.source?.trim() ?? "";
  const disputeIds = await resolveItemDisputeIdsFromInvoice(admin, invoice);
  if (disputeIds.length === 0) {
    if (source === "item_dispute") {
      console.warn("[item-dispute-invoice-webhook] missing item_dispute_id", invoice.id);
    }
    return "ignored";
  }
  if (source && source !== "item_dispute") return "ignored";

  const { data: rows } = await admin
    .from("item_disputes")
    .select("id, status, resolution, cart_dispute_id, item_id")
    .in("id", disputeIds)
    .is("deleted_at", null);
  if (!rows?.length) return "ignored";

  const nowIso = new Date().toISOString();
  let primaryRow = rows[0]!;
  let primaryPrev: Resolution =
    primaryRow.resolution && typeof primaryRow.resolution === "object" && !Array.isArray(primaryRow.resolution)
      ? { ...(primaryRow.resolution as Resolution) }
      : {};

  // Idempotence : déjà tout payé.
  if (
    eventType === "invoice.paid" &&
    rows.every(
      (r) =>
        String((r.resolution as Resolution | null)?.chargeStatus ?? "").toLowerCase() === "paid" &&
        String(r.status ?? "") === "resolved",
    )
  ) {
    return "processed";
  }

  if (eventType === "invoice.paid") {
    let cartDisputeId: string | null = null;
    for (const row of rows) {
      const prev: Resolution =
        row.resolution && typeof row.resolution === "object" && !Array.isArray(row.resolution)
          ? { ...(row.resolution as Resolution) }
          : {};
      if (row.id === primaryRow.id) primaryPrev = prev;
      const history = Array.isArray(prev.history) ? [...(prev.history as unknown[])] : [];
      history.push({
        at: nowIso,
        actorUserId: null,
        action: "stripe_invoice_paid",
        note: invoice.id,
      });
      const memberAlert =
        prev.memberAlert && typeof prev.memberAlert === "object"
          ? {
              ...(prev.memberAlert as Record<string, unknown>),
              status:
                (prev.memberAlert as { status?: string }).status === "acked" ? "acked" : "pending",
              body:
                typeof (prev.memberAlert as { body?: string }).body === "string"
                  ? `${String((prev.memberAlert as { body: string }).body)}\n\nPaiement reçu — litige pièce résolu.`
                  : "Paiement reçu — litige pièce résolu.",
            }
          : prev.memberAlert;

      const { error } = await admin
        .from("item_disputes")
        .update({
          status: "resolved",
          resolution: {
            ...prev,
            chargeStatus: "paid",
            stripeInvoiceId: invoice.id,
            stripeHostedInvoiceUrl: invoice.hosted_invoice_url ?? prev.stripeHostedInvoiceUrl ?? null,
            resolvedAt: typeof prev.resolvedAt === "string" ? prev.resolvedAt : nowIso,
            paidAt: nowIso,
            memberAlert,
            history: history.slice(-40),
          },
          updated_at: nowIso,
        })
        .eq("id", row.id);
      if (error) {
        console.error("[item-dispute-invoice-webhook] paid update", error.message);
        continue;
      }

      cartDisputeId =
        typeof row.cart_dispute_id === "string" ? row.cart_dispute_id : cartDisputeId;
      const itemId = typeof row.item_id === "string" ? row.item_id : "";
      const isLoss =
        String(prev.disposition ?? "") === "lost_not_returned" ||
        String(prev.defectTier ?? "") === "non_return" ||
        String(prev.outcomeFamily ?? "") === "loss";
      if (isLoss && cartDisputeId && itemId) {
        const { data: cartDispute } = await admin
          .from("cart_disputes")
          .select("cart_id")
          .eq("id", cartDisputeId)
          .maybeSingle();
        const cartId =
          cartDispute && typeof (cartDispute as { cart_id?: unknown }).cart_id === "string"
            ? (cartDispute as { cart_id: string }).cart_id
            : "";
        if (cartId) {
          await admin
            .from("cart_items")
            .update({ dispute_line_status: "lost_not_returned", updated_at: nowIso })
            .eq("cart_id", cartId)
            .eq("item_id", itemId)
            .is("deleted_at", null);
        }
      }
    }

    await resolveCartDisputeWhenItemsTerminal(admin, cartDisputeId);

    if (!options?.skipNotify) {
      try {
        const defectTier = typeof primaryPrev.defectTier === "string" ? primaryPrev.defectTier : null;
        const facturationDone = await wasFacturationAlreadyNotified(
          admin,
          primaryRow.id as string,
          defectTier,
        );
        if (!facturationDone) {
          console.info(
            "[item-dispute-invoice-webhook] defer paid notify until facturation sent",
            primaryRow.id,
          );
        } else {
          await notifyItemDisputeInvoicePaid(admin, {
            itemDisputeId: primaryRow.id as string,
            cartDisputeId,
            itemId: typeof primaryRow.item_id === "string" ? primaryRow.item_id : null,
            resolution: primaryPrev,
            billedPoints:
              typeof primaryPrev.billedPoints === "number" ? Math.round(primaryPrev.billedPoints) : 0,
            defectTier,
          });
        }
      } catch (e) {
        console.error(
          "[item-dispute-invoice-webhook] notify paid",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    return "processed";
  }

  if (eventType === "invoice.payment_failed" || eventType === "invoice.marked_uncollectible") {
    for (const row of rows) {
      const prev: Resolution =
        row.resolution && typeof row.resolution === "object" && !Array.isArray(row.resolution)
          ? { ...(row.resolution as Resolution) }
          : {};
      const history = Array.isArray(prev.history) ? [...(prev.history as unknown[])] : [];
      history.push({
        at: nowIso,
        actorUserId: null,
        action: eventType === "invoice.payment_failed" ? "stripe_invoice_failed" : "stripe_uncollectible",
        note: invoice.id,
      });
      await admin
        .from("item_disputes")
        .update({
          resolution: {
            ...prev,
            chargeStatus: "failed",
            stripeInvoiceId: invoice.id,
            stripeHostedInvoiceUrl: invoice.hosted_invoice_url ?? prev.stripeHostedInvoiceUrl ?? null,
            history: history.slice(-40),
          },
          updated_at: nowIso,
        })
        .eq("id", row.id);
    }
    return "processed";
  }

  if (eventType === "invoice.finalized") {
    for (const row of rows) {
      const prev: Resolution =
        row.resolution && typeof row.resolution === "object" && !Array.isArray(row.resolution)
          ? { ...(row.resolution as Resolution) }
          : {};
      await admin
        .from("item_disputes")
        .update({
          resolution: {
            ...prev,
            chargeStatus: prev.chargeStatus === "paid" ? "paid" : "invoiced",
            stripeInvoiceId: invoice.id,
            stripeHostedInvoiceUrl: invoice.hosted_invoice_url ?? prev.stripeHostedInvoiceUrl ?? null,
          },
          updated_at: nowIso,
        })
        .eq("id", row.id);
    }
    return "processed";
  }

  return "ignored";
}
