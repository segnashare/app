import type Stripe from "stripe";

import type { CartCheckoutPaymentDetail } from "@/lib/stripe/fetch-cart-checkout-payment-detail";

type AdminLike = {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => Promise<{ error: { message: string } | null }>;
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

function metaCents(metadata: Stripe.Metadata | null | undefined, key: string): number {
  if (!metadata) return 0;
  const n = Number(metadata[key]);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function resolvePaymentIntentId(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === "string") return pi;
  if (pi && typeof pi === "object" && "id" in pi) return String((pi as { id: string }).id);
  return null;
}

export function stripeInvoiceRowFromCartOrderSession(
  session: Stripe.Checkout.Session,
  userId: string,
): Record<string, unknown> | null {
  const kind = session.metadata?.checkout_kind ?? null;
  if (kind === "cart_order") {
    if (session.payment_status !== "paid") return null;
  } else if (kind === "cart_order_wallet_setup") {
    if (session.mode !== "setup" || session.status !== "complete") return null;
  } else {
    return null;
  }

  const cartId = session.metadata?.cart_id?.trim();
  if (!cartId) return null;

  const md = session.metadata;
  const amountTotal =
    kind === "cart_order_wallet_setup"
      ? 0
      : typeof session.amount_total === "number"
        ? Math.trunc(session.amount_total)
        : 0;
  const feesTtc = metaCents(md, "fees_ttc_cents");
  const feesVat = metaCents(md, "fees_vat_cents");
  const deliveryCh = typeof md?.delivery_channel === "string" ? md.delivery_channel.trim().toLowerCase() : "";
  const homeSp = typeof md?.home_speed === "string" ? md.home_speed.trim().toLowerCase() : "";

  return {
    cart_id: cartId,
    user_id: userId,
    checkout_session_id: session.id,
    payment_intent_id: resolvePaymentIntentId(session),
    amount_total_cents: amountTotal,
    credits_line_cents: metaCents(md, "credits_line_cents"),
    service_ttc_cents: metaCents(md, "service_ttc_cents"),
    shipping_ttc_cents: metaCents(md, "shipping_ttc_cents"),
    fees_ttc_cents: feesTtc > 0 ? feesTtc : null,
    fees_vat_cents: feesVat > 0 ? feesVat : null,
    currency: (session.currency ?? "eur").toLowerCase(),
    checkout_delivery_channel: deliveryCh || null,
    checkout_home_speed: homeSp || null,
  };
}

export async function upsertCartOrderStripeInvoiceFromSession(
  admin: AdminLike,
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<{ ok: boolean; skipped?: boolean }> {
  const row = stripeInvoiceRowFromCartOrderSession(session, userId);
  if (!row) return { ok: true, skipped: true };

  const { error } = await admin.from("cart_order_stripe_invoices").upsert(row, { onConflict: "cart_id" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Snapshot facture après Payment Sheet (PaymentIntent, sans Checkout Session). */
export function stripeInvoiceRowFromCartOrderPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  userId: string,
): Record<string, unknown> | null {
  const kind = paymentIntent.metadata?.checkout_kind ?? null;
  if (kind !== "cart_order") return null;
  if (paymentIntent.status !== "succeeded") return null;

  const cartId = paymentIntent.metadata?.cart_id?.trim();
  if (!cartId) return null;

  const md = paymentIntent.metadata;
  const feesTtc = metaCents(md, "fees_ttc_cents");
  const feesVat = metaCents(md, "fees_vat_cents");
  const deliveryCh = typeof md?.delivery_channel === "string" ? md.delivery_channel.trim().toLowerCase() : "";
  const homeSp = typeof md?.home_speed === "string" ? md.home_speed.trim().toLowerCase() : "";

  return {
    cart_id: cartId,
    user_id: userId,
    checkout_session_id: paymentIntent.id,
    payment_intent_id: paymentIntent.id,
    amount_total_cents: Math.trunc(paymentIntent.amount_received || paymentIntent.amount || 0),
    credits_line_cents: metaCents(md, "credits_line_cents"),
    service_ttc_cents: metaCents(md, "service_ttc_cents"),
    shipping_ttc_cents: metaCents(md, "shipping_ttc_cents"),
    fees_ttc_cents: feesTtc > 0 ? feesTtc : null,
    fees_vat_cents: feesVat > 0 ? feesVat : null,
    currency: (paymentIntent.currency ?? "eur").toLowerCase(),
    checkout_delivery_channel: deliveryCh || null,
    checkout_home_speed: homeSp || null,
  };
}

export async function upsertCartOrderStripeInvoiceFromPaymentIntent(
  admin: AdminLike,
  paymentIntent: Stripe.PaymentIntent,
  userId: string,
): Promise<{ ok: boolean; skipped?: boolean }> {
  const row = stripeInvoiceRowFromCartOrderPaymentIntent(paymentIntent, userId);
  if (!row) return { ok: true, skipped: true };

  const { error } = await admin.from("cart_order_stripe_invoices").upsert(row, { onConflict: "cart_id" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export function stripeInvoiceRowFromGuestPurchaseStripeInvoice(
  invoice: Stripe.Invoice,
  userId: string,
): Record<string, unknown> | null {
  if (invoice.metadata?.source !== "guest_purchase") return null;
  if (invoice.metadata?.checkout_kind !== "cart_order") return null;
  if (invoice.status !== "paid") return null;

  const cartId = invoice.metadata?.cart_id?.trim();
  if (!cartId) return null;

  const md = invoice.metadata;
  const amountTotal =
    typeof invoice.amount_paid === "number"
      ? Math.trunc(invoice.amount_paid)
      : typeof invoice.total === "number"
        ? Math.trunc(invoice.total)
        : 0;
  const feesTtc = metaCents(md, "fees_ttc_cents");
  const feesVat = metaCents(md, "fees_vat_cents");
  const deliveryCh = typeof md?.delivery_channel === "string" ? md.delivery_channel.trim().toLowerCase() : "";
  const homeSp = typeof md?.home_speed === "string" ? md.home_speed.trim().toLowerCase() : "";

  return {
    cart_id: cartId,
    user_id: userId,
    checkout_session_id: `inv_${invoice.id}`,
    payment_intent_id: resolvePaymentIntentIdFromInvoice(invoice),
    amount_total_cents: amountTotal,
    credits_line_cents: metaCents(md, "credits_line_cents"),
    service_ttc_cents: metaCents(md, "service_ttc_cents"),
    shipping_ttc_cents: metaCents(md, "shipping_ttc_cents"),
    fees_ttc_cents: feesTtc > 0 ? feesTtc : null,
    fees_vat_cents: feesVat > 0 ? feesVat : null,
    currency: (invoice.currency ?? "eur").toLowerCase(),
    checkout_delivery_channel: deliveryCh || null,
    checkout_home_speed: homeSp || null,
  };
}

function resolvePaymentIntentIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as Stripe.Invoice & { payment_intent?: string | { id: string } | null })
    .payment_intent;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) return String(legacy.id);
  return null;
}

export async function upsertCartOrderStripeInvoiceFromStripeInvoice(
  admin: AdminLike,
  invoice: Stripe.Invoice,
  userId: string,
): Promise<{ ok: boolean; skipped?: boolean }> {
  const row = stripeInvoiceRowFromGuestPurchaseStripeInvoice(invoice, userId);
  if (!row) return { ok: true, skipped: true };

  const { error } = await admin.from("cart_order_stripe_invoices").upsert(row, { onConflict: "cart_id" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** URL directe PDF ou page hébergée Stripe pour télécharger la facture achat. */
export function guestPurchaseInvoiceDownloadUrlFromStripeInvoice(
  invoice: Stripe.Invoice,
): string | null {
  const pdf = invoice.invoice_pdf?.trim();
  if (pdf) return pdf;
  const hosted = invoice.hosted_invoice_url?.trim();
  return hosted || null;
}

/** Met à jour l’URL facture achat Guest sur le snapshot checkout existant. */
export async function upsertGuestPurchaseStripeInvoiceRecord(
  admin: AdminLike,
  params: {
    cartId: string;
    userId: string;
    stripeInvoiceId: string;
    hostedUrl: string | null;
  },
): Promise<void> {
  const { error } = await admin
    .from("cart_order_stripe_invoices")
    .update({
      guest_purchase_stripe_invoice_id: params.stripeInvoiceId,
      guest_purchase_stripe_invoice_hosted_url: params.hostedUrl,
    })
    .eq("cart_id", params.cartId);

  if (error) {
    throw new Error(error.message);
  }
}

/** ID facture achat Guest depuis le JSON RPC. */
export function guestPurchaseStripeInvoiceIdFromJson(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null;
  const id = (data as Record<string, unknown>).guest_purchase_stripe_invoice_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** URL facture achat Guest depuis le JSON RPC. */
export function guestPurchaseStripeInvoiceHostedUrlFromJson(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null;
  const url = (data as Record<string, unknown>).guest_purchase_stripe_invoice_hosted_url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/** Parse le JSON renvoyé par `get_member_cart_order_stripe_invoice`. */
export function cartOrderStripeInvoiceJsonToEuroDetail(data: unknown): CartCheckoutPaymentDetail | null {
  if (data == null || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const amountTotal = Number(o.amount_total_cents);
  if (!Number.isFinite(amountTotal)) return null;

  const fv = o.fees_vat_cents;
  const ft = o.fees_ttc_cents;
  const feesVatCents = fv == null ? 0 : Number(fv);
  const feesTtcCents = ft == null ? 0 : Number(ft);

  const cdc = o.checkout_delivery_channel;
  const chs = o.checkout_home_speed;
  const checkoutDeliveryChannel =
    typeof cdc === "string" && cdc.trim() ? cdc.trim().toLowerCase() : null;
  const checkoutHomeSpeed = typeof chs === "string" && chs.trim() ? chs.trim().toLowerCase() : null;

  return {
    complementCreditsEuros: Number(o.credits_line_cents ?? 0) / 100,
    serviceFeeEuros: Number(o.service_ttc_cents ?? 0) / 100,
    shippingFeeEuros: Number(o.shipping_ttc_cents ?? 0) / 100,
    totalPaidEuros: amountTotal / 100,
    ...(Number.isFinite(feesVatCents) && feesVatCents > 0 ? { feesVatEuros: feesVatCents / 100 } : {}),
    ...(Number.isFinite(feesTtcCents) && feesTtcCents > 0 ? { feesTtcEuros: feesTtcCents / 100 } : {}),
    ...(checkoutDeliveryChannel ? { checkoutDeliveryChannel } : {}),
    ...(checkoutHomeSpeed ? { checkoutHomeSpeed } : {}),
  };
}
