import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { borrowNonRestitutionChargeTotalCents } from "@/lib/emprunt/borrow-overdue-recovery-policy";
import {
  fetchBorrowCartInvoiceLines,
  type BorrowCartInvoiceLine,
} from "@/lib/cart/fetch-borrow-cart-invoice-lines";
import { getStripeConfig } from "@/lib/social/stripe";
import { ensureStripeCustomerForUser } from "@/lib/stripe/borrow-overdue-checkout";
import { resolveStripeCustomerPaymentMethod } from "@/lib/stripe/stripe-customer-payment-method";

export type CreateBorrowNonRestitutionInvoiceResult =
  | {
      ok: true;
      invoiceId: string;
      hostedInvoiceUrl: string | null;
      cartValueCents: number;
      unpaidPenaltyCents: number;
      totalCents: number;
      dryRun: boolean;
    }
  | { ok: false; error: string };

function stripeInvoiceEnabled(): boolean {
  return process.env.SEGNA_BORROW_NON_RESTITUTION_STRIPE_INVOICE !== "0";
}

function isDryRun(opts?: { forceDryRun?: boolean }): boolean {
  return opts?.forceDryRun === true || process.env.SEGNA_BORROW_NON_RESTITUTION_DRY_RUN === "1";
}

function shouldEmailStripeInvoice(): boolean {
  return process.env.SEGNA_BORROW_NON_RESTITUTION_STRIPE_INVOICE_EMAIL !== "0";
}

function resolveCartValueInvoiceLines(
  cartValueCents: number,
  itemLines: BorrowCartInvoiceLine[],
): BorrowCartInvoiceLine[] {
  if (itemLines.length === 0) {
    return [
      {
        label: "Indemnité non-restitution — valeur du panier",
        valueCents: cartValueCents,
      },
    ];
  }

  const sum = itemLines.reduce((acc, line) => acc + line.valueCents, 0);
  if (sum === cartValueCents) return itemLines;

  // Désalignement rare (cart_value_cents stale) — une ligne agrégée pour cohérence Stripe.
  return [
    {
      label: "Indemnité non-restitution — valeur du panier",
      valueCents: cartValueCents,
    },
  ];
}

export async function createBorrowNonRestitutionStripeInvoice(
  admin: SupabaseClient,
  input: {
    userId: string;
    userEmail?: string | null;
    cartId: string;
    overdueId: string;
    cartValueCents: number;
    unpaidPenaltyCents: number;
    orderRef: string;
    forceDryRun?: boolean;
    /** Réutilise une facture Stripe déjà émise (re-sync DB). */
    existingStripeInvoiceId?: string | null;
    resendStripeEmail?: boolean;
  },
): Promise<CreateBorrowNonRestitutionInvoiceResult> {
  const cartValueCents = Math.max(0, Math.trunc(input.cartValueCents));
  const unpaidPenaltyCents = Math.max(0, Math.trunc(input.unpaidPenaltyCents));
  const totalCents = borrowNonRestitutionChargeTotalCents(cartValueCents, unpaidPenaltyCents);

  let itemLines: BorrowCartInvoiceLine[] = [];
  try {
    itemLines = await fetchBorrowCartInvoiceLines(admin, input.cartId);
  } catch (e) {
    console.error("[borrow-non-restitution] fetch cart lines", input.cartId, e);
  }
  const cartLines = resolveCartValueInvoiceLines(cartValueCents, itemLines);

  if (totalCents < 50) {
    return { ok: false, error: "amount_below_stripe_minimum" };
  }

  if (isDryRun(input)) {
    const fakeId = `dry_run_inv_${input.overdueId.slice(0, 8)}`;
    return {
      ok: true,
      invoiceId: fakeId,
      hostedInvoiceUrl: null,
      cartValueCents,
      unpaidPenaltyCents,
      totalCents,
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

  const metadata = {
    source: "borrow_non_restitution",
    cart_id: input.cartId,
    overdue_id: input.overdueId,
    user_id: input.userId,
    order_ref: input.orderRef,
    unpaid_penalty_cents: String(unpaidPenaltyCents),
  };

  const idempotencyKey = `borrow_non_restitution_invoice:${input.overdueId}`;

  const finalizeIfNeeded = async (invoice: Stripe.Invoice): Promise<Stripe.Invoice> => {
    const fresh = await stripe.invoices.retrieve(invoice.id);
    if (fresh.status !== "draft") {
      return fresh;
    }
    try {
      return await stripe.invoices.finalizeInvoice(fresh.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already finalized|non-draft invoice/i.test(msg)) {
        return stripe.invoices.retrieve(fresh.id);
      }
      throw e;
    }
  };

  const maybeSendInvoiceEmail = async (invoiceId: string) => {
    if (!shouldEmailStripeInvoice() && !input.resendStripeEmail) return;
    try {
      await stripe.invoices.sendInvoice(invoiceId);
    } catch (e) {
      console.error("[borrow-non-restitution] sendInvoice", invoiceId, e);
    }
  };

  try {
    const existingInvoiceId = String(input.existingStripeInvoiceId ?? "").trim();
    if (existingInvoiceId) {
      const existing = await stripe.invoices.retrieve(existingInvoiceId);
      if (existing.metadata?.overdue_id !== input.overdueId) {
        return { ok: false, error: "existing_invoice_overdue_mismatch" };
      }
      const finalized = await finalizeIfNeeded(existing);
      await maybeSendInvoiceEmail(finalized.id);
      const refreshed = await stripe.invoices.retrieve(finalized.id);
      return {
        ok: true,
        invoiceId: refreshed.id,
        hostedInvoiceUrl: refreshed.hosted_invoice_url ?? null,
        cartValueCents,
        unpaidPenaltyCents,
        totalCents,
        dryRun: false,
      };
    }

    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        collection_method: "charge_automatically",
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description: `Segna — indemnité non-restitution emprunt ${input.orderRef}`,
        metadata,
      },
      { idempotencyKey },
    );

    for (let i = 0; i < cartLines.length; i += 1) {
      const line = cartLines[i]!;
      await stripe.invoiceItems.create(
        {
          customer: customerId,
          invoice: invoice.id,
          amount: line.valueCents,
          currency: "eur",
          description: line.label,
          metadata: { ...metadata, line: "cart_item", line_index: String(i) },
        },
        { idempotencyKey: `${idempotencyKey}:cart_line:${i}` },
      );
    }

    if (unpaidPenaltyCents > 0) {
      await stripe.invoiceItems.create(
        {
          customer: customerId,
          invoice: invoice.id,
          amount: unpaidPenaltyCents,
          currency: "eur",
          description: "Frais de retard non réglés",
          metadata: { ...metadata, line: "unpaid_penalties" },
        },
        { idempotencyKey: `${idempotencyKey}:unpaid_penalties` },
      );
    }

    const finalized = await finalizeIfNeeded(invoice);
    await maybeSendInvoiceEmail(finalized.id);

    const refreshed = await stripe.invoices.retrieve(finalized.id);

    return {
      ok: true,
      invoiceId: refreshed.id,
      hostedInvoiceUrl: refreshed.hosted_invoice_url ?? null,
      cartValueCents,
      unpaidPenaltyCents,
      totalCents,
      dryRun: false,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
