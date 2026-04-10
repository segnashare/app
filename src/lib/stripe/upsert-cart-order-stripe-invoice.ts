import type Stripe from "stripe";

import type { CartCheckoutPaymentDetail } from "@/lib/stripe/fetch-cart-checkout-payment-detail";

type AdminLike = {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => Promise<{ error: { message: string } | null }>;
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
  if (session.metadata?.checkout_kind !== "cart_order") return null;
  if (session.payment_status !== "paid") return null;

  const cartId = session.metadata?.cart_id?.trim();
  if (!cartId) return null;

  const md = session.metadata;
  const amountTotal = typeof session.amount_total === "number" ? Math.trunc(session.amount_total) : 0;
  const feesTtc = metaCents(md, "fees_ttc_cents");
  const feesVat = metaCents(md, "fees_vat_cents");

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

  return {
    complementCreditsEuros: Number(o.credits_line_cents ?? 0) / 100,
    serviceFeeEuros: Number(o.service_ttc_cents ?? 0) / 100,
    shippingFeeEuros: Number(o.shipping_ttc_cents ?? 0) / 100,
    totalPaidEuros: amountTotal / 100,
    ...(Number.isFinite(feesVatCents) && feesVatCents > 0 ? { feesVatEuros: feesVatCents / 100 } : {}),
    ...(Number.isFinite(feesTtcCents) && feesTtcCents > 0 ? { feesTtcEuros: feesTtcCents / 100 } : {}),
  };
}
