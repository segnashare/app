import type { SupabaseClient } from "@supabase/supabase-js";
import StripeLib from "stripe";

import { formatDateParis } from "@/lib/datetime/segna-datetime";
import { guestPurchaseInvoicedEmail } from "@/lib/notifications/lifecycle-shipment-email";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";
import { NotificationKind } from "@/lib/notifications/kinds";
import { memberAppCommandeUrl } from "@/lib/notifications/member-app-links";
import type { TransactionalEmailAttachment } from "@/lib/notifications/resend-send";
import { fetchStripeInvoicePdfBuffer } from "@/lib/stripe/fetch-stripe-invoice-pdf";
import { getStripeConfig } from "@/lib/social/stripe";

function guestPurchaseInvoicePdfFilename(orderRef: string): string {
  const safe = orderRef.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
  return `facture-segna-${safe || "achat"}.pdf`;
}

async function resolveGuestPurchaseInvoicePdfBuffer(
  stripe: StripeLib,
  admin: SupabaseClient,
  input: { cartId: string; userId: string; stripeInvoiceId?: string | null },
): Promise<Buffer | null> {
  let invoiceId = input.stripeInvoiceId?.trim() ?? "";
  if (!invoiceId) {
    const { data: invoiceRow } = await admin
      .from("cart_order_stripe_invoices")
      .select("guest_purchase_stripe_invoice_id")
      .eq("cart_id", input.cartId)
      .eq("user_id", input.userId)
      .maybeSingle();
    invoiceId = (
      (invoiceRow as { guest_purchase_stripe_invoice_id?: string | null } | null)?.guest_purchase_stripe_invoice_id ??
      ""
    ).trim();
  }

  if (!invoiceId || invoiceId.startsWith("dry_run_")) return null;

  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const pdfUrl = invoice.invoice_pdf?.trim() ?? "";
    if (!pdfUrl) {
      console.warn("[guest-purchase] invoice_pdf missing", invoiceId);
      return null;
    }
    return fetchStripeInvoicePdfBuffer(pdfUrl);
  } catch (e) {
    console.error("[guest-purchase] retrieve invoice pdf", invoiceId, e);
    return null;
  }
}

/** E-mail confirmation achat (pas de SMS) — facture PDF jointe si disponible. */
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

  const stripe = new StripeLib(getStripeConfig().secretKey);
  const pdfBuffer = await resolveGuestPurchaseInvoicePdfBuffer(stripe, admin, {
    cartId: input.cartId,
    userId: input.userId,
    stripeInvoiceId: input.stripeInvoiceId,
  });
  const pdfAttached = pdfBuffer != null;

  const emailAttachments: TransactionalEmailAttachment[] | undefined = pdfBuffer
    ? [
        {
          filename: guestPurchaseInvoicePdfFilename(input.orderRef),
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
      pdf_attached: pdfAttached,
      invoice_attached: pdfAttached,
    },
    subject,
    text,
    html,
    channels: "email",
    emailAttachments,
  });
}
