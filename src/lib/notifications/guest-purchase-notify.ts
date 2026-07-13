import type { SupabaseClient } from "@supabase/supabase-js";
import StripeLib from "stripe";

import { formatDateParis } from "@/lib/datetime/segna-datetime";
import { guestPurchaseInvoicedEmail } from "@/lib/notifications/lifecycle-shipment-email";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";
import { NotificationKind } from "@/lib/notifications/kinds";
import { memberAppCommandeUrl } from "@/lib/notifications/member-app-links";
import type { TransactionalEmailAttachment } from "@/lib/notifications/resend-send";
import { getStripeConfig } from "@/lib/social/stripe";
import {
  fetchStripeChargeReceiptPdfBufferFromCheckoutSession,
  fetchStripeChargeReceiptPdfBufferFromPaymentIntent,
} from "@/lib/stripe/fetch-stripe-charge-receipt-pdf";

function guestPurchaseReceiptPdfFilename(orderRef: string): string {
  const safe = orderRef.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
  return `recu-segna-${safe || "achat"}.pdf`;
}

async function resolveGuestPurchaseReceiptPdfBuffer(
  stripe: StripeLib,
  admin: SupabaseClient,
  input: { cartId: string; userId: string; paymentIntentId?: string | null },
): Promise<Buffer | null> {
  const piId = input.paymentIntentId?.trim() ?? "";
  if (piId) {
    const fromPi = await fetchStripeChargeReceiptPdfBufferFromPaymentIntent(stripe, piId);
    if (fromPi) return fromPi;
  }

  const { data: invoiceRow } = await admin
    .from("cart_order_stripe_invoices")
    .select("checkout_session_id")
    .eq("cart_id", input.cartId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const checkoutSessionId = (
    (invoiceRow as { checkout_session_id?: string | null } | null)?.checkout_session_id ?? ""
  ).trim();
  if (checkoutSessionId) {
    const fromSession = await fetchStripeChargeReceiptPdfBufferFromCheckoutSession(stripe, checkoutSessionId);
    if (fromSession) return fromSession;
  }

  const { data: debitRow } = await admin
    .from("wallet_transactions")
    .select("metadata")
    .eq("user_id", input.userId)
    .eq("kind", "debit")
    .eq("direction", "debit")
    .filter("metadata->>source", "eq", "cart_order_stripe")
    .filter("metadata->>cart_id", "eq", input.cartId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sessionFromDebit = (
    (debitRow as { metadata?: { stripe_checkout_session_id?: string | null } | null } | null)?.metadata
      ?.stripe_checkout_session_id ?? ""
  ).trim();
  if (sessionFromDebit && sessionFromDebit !== checkoutSessionId) {
    return fetchStripeChargeReceiptPdfBufferFromCheckoutSession(stripe, sessionFromDebit);
  }

  return null;
}

/** E-mail confirmation achat Guest (pas de SMS) — reçu PDF joint si disponible. */
export async function notifyGuestPurchaseInvoiced(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    orderRef: string;
    totalCents: number;
    paymentIntentId?: string | null;
    stripeInvoiceId?: string | null;
  },
): Promise<void> {
  const { data: user } = await admin.from("users").select("first_name").eq("id", input.userId).maybeSingle();
  const firstName = (user as { first_name?: string | null } | null)?.first_name ?? null;
  const commandeUrl = memberAppCommandeUrl(input.cartId);

  const { data: cartRow } = await admin
    .from("carts")
    .select("created_at")
    .eq("id", input.cartId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const createdAt = (cartRow as { created_at?: string | null } | null)?.created_at;
  const orderPlacedAtLabel = createdAt
    ? formatDateParis(createdAt, { day: "2-digit", month: "2-digit", year: "numeric" })
    : formatDateParis(new Date().toISOString(), { day: "2-digit", month: "2-digit", year: "numeric" });

  const paymentIntentId = input.paymentIntentId?.trim() || null;
  const stripe = new StripeLib(getStripeConfig().secretKey);
  const pdfBuffer = await resolveGuestPurchaseReceiptPdfBuffer(stripe, admin, {
    cartId: input.cartId,
    userId: input.userId,
    paymentIntentId,
  });
  const pdfAttached = pdfBuffer != null;

  const emailAttachments: TransactionalEmailAttachment[] | undefined = pdfBuffer
    ? [
        {
          filename: guestPurchaseReceiptPdfFilename(input.orderRef),
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ]
    : undefined;

  const { subject, text, html } = guestPurchaseInvoicedEmail(firstName, {
    orderRef: input.orderRef,
    orderPlacedAtLabel,
    commandeUrl,
    pdfAttached,
  });

  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.guestPurchaseInvoiced,
    idempotencyKey: `txn:guest_purchase_invoice_email:${input.cartId}`,
    metadata: {
      cart_id: input.cartId,
      order_ref: input.orderRef,
      total_cents: input.totalCents,
      stripe_invoice_id: input.stripeInvoiceId ?? null,
      stripe_payment_intent_id: paymentIntentId,
      pdf_attached: pdfAttached,
      receipt_attached: pdfAttached,
    },
    subject,
    text,
    html,
    channels: "email",
    emailAttachments,
  });
}
