import Stripe from "stripe";

import { stripeInvoiceSubscriptionId } from "@/lib/notifications/subscription-notifications";

export type RefundSubscriptionInvoiceResult =
  | { ok: true; didRefund: boolean; refundId?: string; reason?: string }
  | { ok: false; error: string };

function idFromExpandable(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id: string }).id).trim();
  }
  return "";
}

function legacyInvoicePaymentIntent(invoice: Stripe.Invoice): string {
  return idFromExpandable((invoice as { payment_intent?: unknown }).payment_intent);
}

function legacyInvoiceCharge(invoice: Stripe.Invoice): string {
  return idFromExpandable((invoice as { charge?: unknown }).charge);
}

function paymentIntentIdFromPayments(payments: Stripe.InvoicePayment[], invoice: Stripe.Invoice): string {
  for (const payment of payments) {
    if (payment.status !== "paid") continue;
    const pi = idFromExpandable(payment.payment?.payment_intent);
    if (pi) return pi;
  }
  for (const payment of payments) {
    const pi = idFromExpandable(payment.payment?.payment_intent);
    if (pi) return pi;
  }
  return legacyInvoicePaymentIntent(invoice);
}

function chargeIdFromPayments(payments: Stripe.InvoicePayment[], invoice: Stripe.Invoice): string {
  for (const payment of payments) {
    if (payment.status !== "paid") continue;
    const charge = idFromExpandable(payment.payment?.charge);
    if (charge) return charge;
  }
  for (const payment of payments) {
    const charge = idFromExpandable(payment.payment?.charge);
    if (charge) return charge;
  }
  return legacyInvoiceCharge(invoice);
}

async function paymentsForInvoice(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<Stripe.InvoicePayment[]> {
  if (invoice.payments?.data?.length) return invoice.payments.data;
  try {
    const listed = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 10 });
    return listed.data;
  } catch (e) {
    const message = e instanceof Error ? e.message : "invoice_payments_list_failed";
    console.warn("[refundLatestSubscriptionInvoice] invoicePayments.list", message);
    return [];
  }
}

async function chargeIdFromCustomerCharges(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<string> {
  const customerId = idFromExpandable(invoice.customer);
  if (!customerId) return "";
  try {
    const listed = await stripe.charges.list({ customer: customerId, limit: 30 });
    const match = listed.data.find((charge) => {
      if (charge.status !== "succeeded" && charge.paid !== true) return false;
      const chargeInvoice = idFromExpandable((charge as { invoice?: unknown }).invoice);
      return chargeInvoice === invoice.id;
    });
    return match?.id?.trim() ?? "";
  } catch (e) {
    const message = e instanceof Error ? e.message : "charges_list_failed";
    console.warn("[refundLatestSubscriptionInvoice] charges.list", message);
    return "";
  }
}

async function resolveRefundTarget(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<{ paymentIntentId: string; chargeId: string }> {
  const payments = await paymentsForInvoice(stripe, invoice);
  let paymentIntentId = paymentIntentIdFromPayments(payments, invoice);
  let chargeId = chargeIdFromPayments(payments, invoice);
  if (!paymentIntentId && !chargeId) {
    chargeId = await chargeIdFromCustomerCharges(stripe, invoice);
  }
  return { paymentIntentId, chargeId };
}

function isAlreadyRefundedError(error: unknown): boolean {
  const err = error as Stripe.StripeRawError & { message?: string };
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  return (
    code === "charge_already_refunded" ||
    msg.includes("already been refunded") ||
    msg.includes("has already been refunded")
  );
}

async function retrieveInvoiceBestEffort(stripe: Stripe, invoiceId: string): Promise<Stripe.Invoice> {
  try {
    return await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
  } catch {
    return stripe.invoices.retrieve(invoiceId);
  }
}

async function loadLatestSubscriptionInvoice(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<Stripe.Invoice | null> {
  const latestId = idFromExpandable(subscription.latest_invoice);
  if (latestId) {
    return retrieveInvoiceBestEffort(stripe, latestId);
  }

  try {
    const listed = await stripe.invoices.list({
      subscription: subscription.id,
      limit: 5,
      expand: ["data.payments"],
    });
    const matching = listed.data.find((invoice) => {
      const subId = stripeInvoiceSubscriptionId(invoice);
      return !subId || subId === subscription.id;
    });
    return matching ?? listed.data[0] ?? null;
  } catch (e) {
    const message = e instanceof Error ? e.message : "invoice_list_failed";
    console.warn("[refundLatestSubscriptionInvoice] invoices.list(subscription)", message);
  }

  const customerId = idFromExpandable(subscription.customer);
  if (!customerId) return null;
  const byCustomer = await stripe.invoices.list({ customer: customerId, limit: 10 });
  const matching = byCustomer.data.find((invoice) => {
    const subId = stripeInvoiceSubscriptionId(invoice);
    return subId === subscription.id;
  });
  return matching ?? null;
}

/**
 * Rembourse (ou void) la dernière facture d’abonnement Stripe.
 * Idempotent par `subscription.id`. Ne throw jamais — toujours `{ ok }`.
 */
export async function refundLatestSubscriptionInvoiceIfNeeded(opts: {
  stripe: Stripe;
  subscription: Stripe.Subscription;
}): Promise<RefundSubscriptionInvoiceResult> {
  try {
    let invoice: Stripe.Invoice | null;
    try {
      invoice = await loadLatestSubscriptionInvoice(opts.stripe, opts.subscription);
    } catch (e) {
      const message = e instanceof Error ? e.message : "invoice_retrieve_failed";
      console.error("[refundLatestSubscriptionInvoice] retrieve", message);
      return { ok: false, error: `Facture Stripe introuvable (${message}).` };
    }

    if (!invoice) {
      return { ok: true, didRefund: false, reason: "no_invoice" };
    }

    if (invoice.status === "draft") {
      return { ok: true, didRefund: false, reason: "draft_invoice" };
    }

    if (invoice.status === "open" || invoice.status === "uncollectible") {
      try {
        await opts.stripe.invoices.voidInvoice(invoice.id);
        return { ok: true, didRefund: false, reason: "invoice_voided" };
      } catch (e) {
        const message = e instanceof Error ? e.message : "invoice_void_failed";
        console.error("[refundLatestSubscriptionInvoice] void", message);
        return { ok: false, error: `Impossible d’annuler la facture ouverte (${message}).` };
      }
    }

    if (invoice.status === "void") {
      return { ok: true, didRefund: false, reason: "already_void" };
    }

    const amountPaid = Math.max(0, Math.trunc(invoice.amount_paid ?? 0));
    if (amountPaid <= 0) {
      return { ok: true, didRefund: false, reason: "zero_amount" };
    }

    const { paymentIntentId, chargeId } = await resolveRefundTarget(opts.stripe, invoice);
    if (!paymentIntentId && !chargeId) {
      return { ok: false, error: "Paiement Stripe introuvable pour le remboursement." };
    }

    const idem = `subscription_cancel_refund:${opts.subscription.id}`;
    try {
      const refund = await opts.stripe.refunds.create(
        paymentIntentId ? { payment_intent: paymentIntentId } : { charge: chargeId },
        { idempotencyKey: idem },
      );
      return { ok: true, didRefund: true, refundId: refund.id };
    } catch (e) {
      if (isAlreadyRefundedError(e)) {
        return { ok: true, didRefund: true, reason: "already_refunded" };
      }
      const message = e instanceof Error ? e.message : "refund_failed";
      console.error("[refundLatestSubscriptionInvoice] refund", message);
      return { ok: false, error: `Le remboursement Stripe a échoué (${message}).` };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "refund_failed";
    console.error("[refundLatestSubscriptionInvoice] unexpected", message);
    return { ok: false, error: `Le remboursement Stripe a échoué (${message}).` };
  }
}
