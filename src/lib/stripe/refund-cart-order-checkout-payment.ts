import { stripeCancelFeeBreakdownFromTotalCents } from "@/lib/cart/cart-order-cancel-stripe-fee";
import Stripe from "stripe";

export type CartOrderInvoiceForRefund = {
  amount_total_cents?: unknown;
  payment_intent_id?: unknown;
  checkout_session_id?: unknown;
};

/**
 * Rembourse le paiement Checkout lié au panier (complément € échange), idempotent par `cartId`.
 * À appeler après `member_cancel_cart_order_pending_preparation` / `backoffice_cancel_cart_order_pending_preparation`.
 */
export async function refundCartOrderStripePaymentIfNeeded(opts: {
  stripe: Stripe;
  cartId: string;
  invoice: CartOrderInvoiceForRefund | null;
  /** Taux retenu (ex. membre 0.2, BO 0). Défaut = taux membre. */
  feeRate?: number;
}): Promise<{ ok: true; didRefund: boolean } | { ok: false; error: string }> {
  const cents = Math.trunc(Number(opts.invoice?.amount_total_cents ?? 0));
  if (!opts.invoice || cents <= 0) {
    return { ok: true, didRefund: false };
  }

  let piId =
    typeof opts.invoice.payment_intent_id === "string" ? opts.invoice.payment_intent_id.trim() : "";

  if (!piId) {
    const sid =
      typeof opts.invoice.checkout_session_id === "string" ? opts.invoice.checkout_session_id.trim() : "";
    if (!sid) {
      return { ok: false, error: "Paiement carte introuvable pour le remboursement." };
    }
    const sess = await opts.stripe.checkout.sessions.retrieve(sid, { expand: ["payment_intent"] });
    const pi = sess.payment_intent;
    piId =
      typeof pi === "string"
        ? pi
        : pi && typeof pi === "object" && pi !== null && "id" in pi
          ? String((pi as Stripe.PaymentIntent).id)
          : "";
  }

  if (!piId) {
    return { ok: false, error: "Intent de paiement introuvable pour le remboursement." };
  }

  const { refundCents } = stripeCancelFeeBreakdownFromTotalCents(cents, opts.feeRate);
  if (refundCents <= 0) {
    return { ok: true, didRefund: false };
  }

  const idem = `cart_order_cancel_refund_partial:${opts.cartId}:${refundCents}`;
  try {
    await opts.stripe.refunds.create(
      { payment_intent: piId, amount: refundCents },
      { idempotencyKey: idem },
    );
    return { ok: true, didRefund: true };
  } catch (e: unknown) {
    const err = e as Stripe.StripeRawError & { message?: string };
    const code = err?.code ?? "";
    const msg = (err?.message ?? "").toLowerCase();
    if (
      code === "charge_already_refunded" ||
      msg.includes("already been refunded") ||
      msg.includes("has already been refunded")
    ) {
      return { ok: true, didRefund: true };
    }
    console.error("[refundCartOrderStripePaymentIfNeeded]", e);
    return { ok: false, error: "Le remboursement carte a échoué. Réessaie ou contacte le support." };
  }
}
