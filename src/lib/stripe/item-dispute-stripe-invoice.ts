import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { ensureStripeCustomerForUser } from "@/lib/stripe/borrow-overdue-checkout";
import { resolveStripeCustomerPaymentMethod } from "@/lib/stripe/stripe-customer-payment-method";

export type ItemDisputeInvoiceLineInput = {
  itemDisputeId: string;
  itemTitle: string;
  defectTier: string;
  billedPoints: number;
  billingPercent: number;
};

export type CreateItemDisputeStripeInvoiceResult =
  | {
      ok: true;
      invoiceId: string;
      hostedInvoiceUrl: string | null;
      amountCents: number;
      dryRun: boolean;
    }
  | { ok: false; error: string };

function stripeInvoiceEnabled(): boolean {
  return process.env.SEGNA_ITEM_DISPUTE_STRIPE_INVOICE !== "0";
}

function isDryRun(opts?: { forceDryRun?: boolean }): boolean {
  return opts?.forceDryRun === true || process.env.SEGNA_ITEM_DISPUTE_DRY_RUN === "1";
}

function shouldEmailStripeInvoice(): boolean {
  return process.env.SEGNA_ITEM_DISPUTE_STRIPE_INVOICE_EMAIL !== "0";
}

function normalizeLines(
  input: {
    itemDisputeId: string;
    itemTitle: string;
    defectTier: string;
    billedPoints: number;
    billingPercent: number;
    lines?: ItemDisputeInvoiceLineInput[];
  },
): ItemDisputeInvoiceLineInput[] {
  if (Array.isArray(input.lines) && input.lines.length > 0) {
    return input.lines
      .map((l) => ({
        itemDisputeId: String(l.itemDisputeId ?? "").trim(),
        itemTitle: String(l.itemTitle ?? "pièce").trim() || "pièce",
        defectTier: String(l.defectTier ?? "").trim() || "unknown",
        billedPoints: Math.max(0, Math.round(Number(l.billedPoints ?? 0))),
        billingPercent: Math.max(0, Math.round(Number(l.billingPercent ?? 0))),
      }))
      .filter((l) => l.itemDisputeId && l.billedPoints > 0);
  }
  const billedPoints = Math.max(0, Math.round(input.billedPoints));
  if (billedPoints <= 0) return [];
  return [
    {
      itemDisputeId: input.itemDisputeId,
      itemTitle: input.itemTitle,
      defectTier: input.defectTier,
      billedPoints,
      billingPercent: input.billingPercent,
    },
  ];
}

/**
 * Facture Stripe litige pièce — 1 point = 1 € → amountCents = billedPoints * 100.
 * Multi-pièces : une facture, une ligne Stripe par pièce (détail sur le reçu).
 * Metadata `source: item_dispute` pour le webhook.
 */
export async function createItemDisputeStripeInvoice(
  admin: SupabaseClient,
  input: {
    userId: string;
    userEmail?: string | null;
    itemDisputeId: string;
    cartId?: string | null;
    cartDisputeId?: string | null;
    itemTitle: string;
    defectTier: string;
    billedPoints: number;
    billingPercent: number;
    /** Lignes multi-pièces (sinon une seule ligne depuis les champs ci-dessus). */
    lines?: ItemDisputeInvoiceLineInput[];
    forceDryRun?: boolean;
  },
): Promise<CreateItemDisputeStripeInvoiceResult> {
  const lines = normalizeLines(input);
  if (lines.length === 0) {
    return { ok: false, error: "amount_below_stripe_minimum" };
  }

  const totalPoints = lines.reduce((s, l) => s + l.billedPoints, 0);
  const amountCents = totalPoints * 100;
  if (amountCents < 50) {
    return { ok: false, error: "amount_below_stripe_minimum" };
  }

  const primaryId = lines[0]!.itemDisputeId;
  const disputeIds = lines.map((l) => l.itemDisputeId);
  const sortedKey = [...disputeIds].sort().join(",");

  if (isDryRun(input)) {
    return {
      ok: true,
      invoiceId: `dry_run_item_dispute_${primaryId.slice(0, 8)}`,
      hostedInvoiceUrl: null,
      amountCents,
      dryRun: true,
    };
  }

  if (!stripeInvoiceEnabled()) {
    return { ok: false, error: "stripe_invoice_disabled" };
  }

  let stripe: Stripe;
  try {
    stripe = new Stripe(getStripeConfig().secretKey);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const customerId = await ensureStripeCustomerForUser(
    admin,
    stripe,
    input.userId,
    input.userEmail,
  );

  const pm = await resolveStripeCustomerPaymentMethod(stripe, admin, input.userId);
  if (pm.ok) {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pm.paymentMethodId },
    });
  }

  const metadata: Record<string, string> = {
    source: "item_dispute",
    item_dispute_id: primaryId,
    item_dispute_ids: disputeIds.join(",").slice(0, 490),
    user_id: input.userId,
    cart_id: input.cartId ?? "",
    cart_dispute_id: input.cartDisputeId ?? "",
    defect_tier: lines[0]!.defectTier,
    billed_points: String(totalPoints),
    billing_percent: String(lines[0]!.billingPercent),
    line_count: String(lines.length),
  };

  const idempotencyKey =
    lines.length > 1
      ? `item_dispute_invoice_batch:${input.cartDisputeId ?? "nocd"}:${sortedKey.slice(0, 120)}`
      : `item_dispute_invoice:${primaryId}`;

  const description =
    lines.length > 1
      ? `Segna — litige pièces (${lines.length}) · ${totalPoints.toFixed(0)} €`
      : `Segna — litige pièce « ${lines[0]!.itemTitle.slice(0, 80)} » (${lines[0]!.billingPercent}%)`;

  try {
    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        collection_method: "charge_automatically",
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description,
        metadata,
      },
      { idempotencyKey },
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineCents = line.billedPoints * 100;
      const lineDesc = `Indemnité « ${line.itemTitle.slice(0, 72)} » (${line.billingPercent} %)`;
      await stripe.invoiceItems.create(
        {
          customer: customerId,
          invoice: invoice.id,
          amount: lineCents,
          currency: "eur",
          description: lineDesc,
          metadata: {
            source: "item_dispute",
            item_dispute_id: line.itemDisputeId,
            cart_dispute_id: input.cartDisputeId ?? "",
            defect_tier: line.defectTier,
            billed_points: String(line.billedPoints),
            billing_percent: String(line.billingPercent),
          },
        },
        { idempotencyKey: `${idempotencyKey}:line:${i}:${line.itemDisputeId.slice(0, 8)}` },
      );
    }

    let finalized = await stripe.invoices.retrieve(invoice.id);
    if (finalized.status === "draft") {
      try {
        finalized = await stripe.invoices.finalizeInvoice(finalized.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/already finalized|non-draft invoice/i.test(msg)) throw e;
        finalized = await stripe.invoices.retrieve(finalized.id);
      }
    }

    if (shouldEmailStripeInvoice()) {
      try {
        await stripe.invoices.sendInvoice(finalized.id);
      } catch (e) {
        console.error("[item-dispute-invoice] sendInvoice", finalized.id, e);
      }
    }

    if (finalized.status === "open") {
      try {
        finalized = await stripe.invoices.pay(finalized.id);
      } catch (e) {
        console.warn(
          "[item-dispute-invoice] pay deferred",
          finalized.id,
          e instanceof Error ? e.message : String(e),
        );
        finalized = await stripe.invoices.retrieve(finalized.id);
      }
    }

    const refreshed = await stripe.invoices.retrieve(finalized.id);
    return {
      ok: true,
      invoiceId: refreshed.id,
      hostedInvoiceUrl: refreshed.hosted_invoice_url ?? null,
      amountCents,
      dryRun: false,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
