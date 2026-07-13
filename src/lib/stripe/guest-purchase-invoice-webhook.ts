import type Stripe from "stripe";

/**
 * Les achats Guest passent par Checkout Session ; la facture est émise après paiement
 * dans `issueGuestPurchaseStripeInvoiceAfterCheckoutPayment` — pas via invoice.paid.
 */
export async function processGuestPurchaseStripeInvoiceEvent(
  _admin: unknown,
  invoice: Stripe.Invoice,
  _eventType: string,
): Promise<"processed" | "ignored"> {
  if (invoice.metadata?.source === "guest_purchase") {
    return "ignored";
  }
  return "ignored";
}
