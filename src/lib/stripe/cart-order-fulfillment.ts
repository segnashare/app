import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendcloudOutboundMetaFromSelection } from "@/lib/cart/checkout-sendcloud-outbound-option";
import type { CheckoutSendcloudOutboundOption } from "@/lib/cart/checkout-sendcloud-outbound-option";
import { provisionCartOutboundSendcloudOrder } from "@/lib/cart/provision-cart-outbound-sendcloud-order";
import { persistCartOutboundSendcloudCheckoutMeta } from "@/lib/stripe/persist-cart-sendcloud-outbound-meta";
import { upsertCartOrderStripeInvoiceFromSession } from "@/lib/stripe/upsert-cart-order-stripe-invoice";

/** Même valeur en metadata expédition que pour un paiement 100 % wallet (pas de session Checkout). */
export const CART_ORDER_WALLET_ONLY_CHECKOUT_SESSION_ID = "wallet_only";

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
 * Après `wallet_credit_purchase` du complément € (seau consommation), le solde total couvre le panier.
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
 * Panier entièrement couvert par le wallet + frais nuls (aucune session Stripe).
 * Débit idempotent par `cart_id` (ne pas réutiliser la clé Stripe).
 */
export async function debitCartWalletOnly(
  admin: AdminClient,
  userId: string,
  cartId: string,
  creditsKind: string | null,
): Promise<void> {
  const { error } = await admin.rpc("wallet_debit_cart_order_stripe", {
    p_user_id: userId,
    p_cart_id: cartId,
    p_checkout_session_id: "",
    p_idempotency_key: `wallet_only:cart_order_debit:${cartId}`,
    p_metadata: {
      exchange_credits_kind: creditsKind,
      checkout_mode: "wallet_only",
    },
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Confirmation panier sans Stripe (même RPC que post-Checkout, métadonnées traçables).
 */
export type ConfirmCartReturnRelayFields = {
  returnRelayPointId: string;
  returnRelayLabel: string;
  returnRelaySearchPostalCode: string;
};

function sendcloudOutboundFromStripeMetadata(
  meta: Stripe.Metadata | null | undefined,
): CheckoutSendcloudOutboundOption | null {
  const code = (meta?.sendcloud_outbound_option_code ?? "").trim();
  if (!code) return null;
  return {
    optionCode: code,
    optionId: (meta?.sendcloud_outbound_option_id ?? "").trim(),
    title: (meta?.sendcloud_outbound_method_title ?? "").trim() || "Livraison",
    carrierCode: (meta?.sendcloud_outbound_carrier ?? "").trim(),
    carrierName: (meta?.sendcloud_outbound_carrier ?? "").trim(),
    shippingRateCents: null,
  };
}

export async function confirmCartPaidWalletOnly(
  admin: AdminClientWithTable,
  userId: string,
  cartId: string,
  deliveryChannel: "relay" | "home",
  relayPointId: string,
  deliveryLine1: string,
  returnRelay?: ConfirmCartReturnRelayFields,
): Promise<void> {
  const { error } = await admin.rpc("confirm_cart_paid_from_stripe", {
    p_cart_id: cartId,
    p_user_id: userId,
    p_checkout_session_id: CART_ORDER_WALLET_ONLY_CHECKOUT_SESSION_ID,
    p_delivery_channel: deliveryChannel,
    p_relay_point_id: relayPointId.trim() ? relayPointId.trim() : null,
    p_delivery_line1: deliveryLine1.trim() ? deliveryLine1.trim() : null,
    p_return_relay_point_id: returnRelay?.returnRelayPointId?.trim() || null,
    p_return_relay_label: returnRelay?.returnRelayLabel?.trim() || null,
    p_return_relay_search_postal_code: returnRelay?.returnRelaySearchPostalCode?.trim() || null,
  });

  if (error) {
    throw new Error(error.message);
  }

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
  const returnRelayPointId = (session.metadata?.return_relay_code ?? "").trim();
  const returnRelayLabel = (session.metadata?.return_relay_label ?? "").trim();
  const returnRelaySearchPostalCode = (session.metadata?.return_relay_search_postal_code ?? "").trim();

  const { data: confirmData, error } = await admin.rpc("confirm_cart_paid_from_stripe", {
    p_cart_id: cartId,
    p_user_id: userId,
    p_checkout_session_id: session.id,
    p_delivery_channel: deliveryChannel,
    p_relay_point_id: relayPointId || null,
    p_delivery_line1: deliveryLine1 || null,
    p_return_relay_point_id: returnRelayPointId || null,
    p_return_relay_label: returnRelayLabel || null,
    p_return_relay_search_postal_code: returnRelaySearchPostalCode || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const scOutbound = sendcloudOutboundFromStripeMetadata(session.metadata);
  if (scOutbound) {
    await persistCartOutboundSendcloudCheckoutMeta(
      admin as unknown as Parameters<typeof persistCartOutboundSendcloudCheckoutMeta>[0],
      cartId,
      sendcloudOutboundMetaFromSelection(scOutbound),
    );
  }

  const alreadyConfirmed =
    confirmData != null &&
    typeof confirmData === "object" &&
    (confirmData as Record<string, unknown>).already_confirmed === true;

  try {
    await upsertCartOrderStripeInvoiceFromSession(admin, session, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[cart-order] cart_order_stripe_invoices upsert failed", msg);
  }

  const homeSpeed = (session.metadata?.home_speed ?? "").trim() || null;
  try {
    await provisionCartOutboundSendcloudOrder(admin as unknown as SupabaseClient, {
      cartId,
      deliveryChannel,
      homeSpeed,
    });
  } catch (e) {
    console.error("[cart-order] sendcloud provision after stripe confirm", e);
  }

  return { ok: true, alreadyConfirmed };
}
