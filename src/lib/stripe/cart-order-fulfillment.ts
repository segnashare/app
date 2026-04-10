import type Stripe from "stripe";

import { upsertCartOrderStripeInvoiceFromSession } from "@/lib/stripe/upsert-cart-order-stripe-invoice";

type AdminClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Client admin avec `.from` pour persister le snapshot facture Stripe. */
type AdminClientWithTable = AdminClient & {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

/**
 * Débite le wallet du montant total échange du panier (somme des `price_points` en base).
 * À exécuter après `wallet_credit_purchase` du complément Stripe pour que le solde soit suffisant.
 */
export async function debitCartExchangeWalletFromStripeSession(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<{ ok: boolean; skipped?: boolean }> {
  if (session.metadata?.checkout_kind !== "cart_order") {
    return { ok: true, skipped: true };
  }

  const cartId = session.metadata?.cart_id?.trim();
  if (!cartId) {
    throw new Error("cart_order: metadata cart_id manquant");
  }

  const creditsKind = session.metadata?.exchange_credits_kind ?? null;

  const { error } = await admin.rpc("wallet_debit_cart_order_stripe", {
    p_user_id: userId,
    p_cart_id: cartId,
    p_checkout_session_id: session.id,
    p_idempotency_key: `stripe:cart_order_debit:${session.id}`,
    p_metadata: {
      exchange_credits_kind: creditsKind,
      stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return { ok: true };
}

/**
 * Panier payé sur Stripe : confirmation + expédition (RPC `confirm_cart_paid_from_stripe`).
 * Idempotent si le panier est déjà `confirmed`.
 */
export async function confirmCartPaidFromStripeSession(
  admin: AdminClientWithTable,
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<{ ok: boolean; alreadyConfirmed?: boolean; skipped?: boolean }> {
  if (session.metadata?.checkout_kind !== "cart_order") {
    return { ok: true, skipped: true };
  }

  const cartId = session.metadata?.cart_id?.trim();
  if (!cartId) {
    throw new Error("cart_order: metadata cart_id manquant");
  }

  const deliveryChannel = session.metadata?.delivery_channel === "home" ? "home" : "relay";
  const relayPointId = (session.metadata?.relay_code ?? "").trim();
  const deliveryLine1 = (session.metadata?.delivery_line1 ?? "").trim();

  const { error } = await admin.rpc("confirm_cart_paid_from_stripe", {
    p_cart_id: cartId,
    p_user_id: userId,
    p_checkout_session_id: session.id,
    p_delivery_channel: deliveryChannel,
    p_relay_point_id: relayPointId || null,
    p_delivery_line1: deliveryLine1 || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  try {
    await upsertCartOrderStripeInvoiceFromSession(admin, session, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[cart-order] cart_order_stripe_invoices upsert failed", msg);
  }

  return { ok: true };
}
