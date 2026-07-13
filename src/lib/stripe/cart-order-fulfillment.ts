import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import StripeLib from "stripe";

import { sendcloudOutboundMetaFromSelection } from "@/lib/cart/checkout-sendcloud-outbound-option";
import type { CheckoutSendcloudOutboundOption } from "@/lib/cart/checkout-sendcloud-outbound-option";
import { toRelayCheckoutSendcloudOutboundOption } from "@/lib/cart/use-checkout-relay-sendcloud-pricing";
import { provisionCartOutboundSendcloudOrder } from "@/lib/cart/provision-cart-outbound-sendcloud-order";
import { finalizeCoursierExpressHomeAfterConfirm } from "@/lib/cart/coursier-checkout-meta";
import { fetchCheckoutRelaySendcloudPricing } from "@/lib/sendcloud/checkout-relay-delivery-options";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { persistCartOutboundSendcloudCheckoutMeta } from "@/lib/stripe/persist-cart-sendcloud-outbound-meta";
import { upsertCartOrderStripeInvoiceFromSession, upsertCartOrderStripeInvoiceFromStripeInvoice } from "@/lib/stripe/upsert-cart-order-stripe-invoice";
import { getStripeConfig } from "@/lib/social/stripe";
import {
  issueGuestPurchaseStripeInvoiceAfterCheckoutPayment,
  checkoutSessionIsGuestPurchase,
  resolveGuestPurchaseCheckoutSession,
} from "@/lib/stripe/guest-purchase-stripe-invoice";

/** Même valeur en metadata expédition que pour un paiement 100 % wallet (pas de session Checkout). */
export const CART_ORDER_WALLET_ONLY_CHECKOUT_SESSION_ID = "wallet_only";

function isCartOrderCheckoutKind(kind: string | undefined | null): boolean {
  return kind === "cart_order" || kind === "cart_order_wallet_setup";
}

export function cartOrderWalletDebitIdempotencyKey(cartId: string): string {
  return `cart_order_debit:cart:${cartId.trim()}`;
}

export function isCartOrderStripeCheckoutPaid(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

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
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Débite le wallet pour la part du panier non couverte par le complément Stripe €.
 * Le complément Stripe ne crédite pas le wallet (metadata `stripe_wallet_comp_points`).
 */
export async function debitCartExchangeWalletFromStripeSession(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!isCartOrderCheckoutKind(session.metadata?.checkout_kind)) {
    return { ok: true, skipped: true };
  }

  const cartId = session.metadata?.cart_id?.trim();
  if (!cartId) {
    throw new Error("cart_order: metadata cart_id manquant");
  }

  const creditsKind = session.metadata?.exchange_credits_kind ?? null;
  const missingRaw = Number(session.metadata?.missing_exchange_mods ?? 0);
  const stripeCompPoints = Number.isFinite(missingRaw) ? Math.max(0, Math.trunc(missingRaw)) : 0;

  const { error } = await admin.rpc("wallet_debit_cart_order_stripe", {
    p_user_id: userId,
    p_cart_id: cartId,
    p_checkout_session_id: session.id,
    p_idempotency_key: cartOrderWalletDebitIdempotencyKey(cartId),
    p_metadata: {
      exchange_credits_kind: creditsKind,
      stripe_wallet_comp_points: stripeCompPoints,
      stripe_wallet_comp_credits_kind: stripeCompPoints > 0 ? "consumption" : null,
      stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
      stripe_checkout_session_id: session.id,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return { ok: true };
}

export type ConfirmCartReturnRelayFields = {
  returnRelayPointId: string;
  returnRelayLabel: string;
  returnRelaySearchPostalCode: string;
};

type FinalizeCartOrderCheckoutParams = {
  userId: string;
  cartId: string;
  checkoutSessionId: string;
  walletIdempotencyKey: string;
  walletMetadata?: Record<string, unknown>;
  deliveryChannel: "relay" | "home";
  relayPointId: string;
  deliveryLine1: string;
  returnRelay?: ConfirmCartReturnRelayFields;
};

/** Débit wallet + confirmation panier dans une seule transaction Postgres. */
export async function finalizeCartOrderCheckout(
  admin: AdminClient,
  params: FinalizeCartOrderCheckoutParams,
): Promise<{ alreadyConfirmed?: boolean }> {
  const { data, error } = await admin.rpc("finalize_cart_order_checkout", {
    p_cart_id: params.cartId,
    p_user_id: params.userId,
    p_checkout_session_id: params.checkoutSessionId,
    p_wallet_idempotency_key: params.walletIdempotencyKey,
    p_wallet_metadata: params.walletMetadata ?? {},
    p_delivery_channel: params.deliveryChannel,
    p_relay_point_id: params.relayPointId.trim() ? params.relayPointId.trim() : null,
    p_delivery_line1: params.deliveryLine1.trim() ? params.deliveryLine1.trim() : null,
    p_return_relay_point_id: params.returnRelay?.returnRelayPointId?.trim() || null,
    p_return_relay_label: params.returnRelay?.returnRelayLabel?.trim() || null,
    p_return_relay_search_postal_code: params.returnRelay?.returnRelaySearchPostalCode?.trim() || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const alreadyConfirmed =
    data != null &&
    typeof data === "object" &&
    (data as Record<string, unknown>).already_confirmed === true;

  return { alreadyConfirmed };
}

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

/**
 * Transporteur aller pour provision Sendcloud : body checkout, ou repli serveur (wallet sans sessionStorage).
 */
export async function resolveCartCheckoutSendcloudOutboundSelection(params: {
  deliveryChannel: "relay" | "home";
  clientSelection: CheckoutSendcloudOutboundOption | null;
  activeOutboundOptionCode: string | null;
  relayCarrierHint?: string | null;
  itemCount: number;
  memberPostalCode: string;
}): Promise<CheckoutSendcloudOutboundOption | null> {
  if (params.clientSelection?.optionCode?.trim()) {
    return params.clientSelection;
  }

  const code = params.activeOutboundOptionCode?.trim();
  if (!code) return null;

  const env = getSendcloudEnv();
  const pc = params.memberPostalCode.replace(/\D/g, "").slice(0, 5);
  if (params.deliveryChannel === "relay" && env && pc.length >= 5) {
    const priced = await fetchCheckoutRelaySendcloudPricing(env, {
      itemCount: params.itemCount,
      memberPostalCode: pc,
    });
    if (priced.ok) {
      return toRelayCheckoutSendcloudOutboundOption(priced.pricing, params.relayCarrierHint);
    }
  }

  const carrier = (params.relayCarrierHint ?? "").trim();
  return {
    optionCode: code,
    optionId: "",
    title: params.deliveryChannel === "relay" ? "Livraison en relais" : "Livraison à domicile",
    carrierCode: carrier,
    carrierName: carrier,
    shippingRateCents: null,
  };
}

/** Après `confirm_cart_paid_from_stripe` : meta transporteur + commande Sendcloud aller (retour après étiquette aller). */
export async function finalizeCartOutboundSendcloudAfterConfirm(
  admin: AdminClientWithTable,
  params: {
    cartId: string;
    deliveryChannel: "relay" | "home";
    homeSpeed?: string | null;
    sendcloudOutbound: CheckoutSendcloudOutboundOption | null;
  },
): Promise<void> {
  if (params.sendcloudOutbound?.optionCode?.trim()) {
    await persistCartOutboundSendcloudCheckoutMeta(
      admin as unknown as Parameters<typeof persistCartOutboundSendcloudCheckoutMeta>[0],
      params.cartId,
      sendcloudOutboundMetaFromSelection(params.sendcloudOutbound),
    );
  }

  const client = admin as unknown as SupabaseClient;

  const outbound = await provisionCartOutboundSendcloudOrder(client, {
    cartId: params.cartId,
    deliveryChannel: params.deliveryChannel,
    homeSpeed: params.homeSpeed ?? null,
  });
  if (!outbound.ok) {
    console.error("[cart-order] sendcloud outbound provision failed", outbound.error);
  } else if ("skipped" in outbound && outbound.skipped) {
    console.info("[cart-order] sendcloud outbound provision skipped", outbound.reason);
  } else if ("orderNumber" in outbound) {
    console.info("[cart-order] sendcloud outbound provisioned", outbound.orderNumber);
  }
}

/** @deprecated Utiliser finalizeCartOutboundSendcloudAfterConfirm (aller au paiement, retour après étiquette aller). */
export const finalizeCartSendcloudOrdersAfterConfirm = finalizeCartOutboundSendcloudAfterConfirm;

export async function confirmCartPaidWalletOnly(
  admin: AdminClientWithTable,
  userId: string,
  cartId: string,
  deliveryChannel: "relay" | "home",
  relayPointId: string,
  deliveryLine1: string,
  returnRelay?: ConfirmCartReturnRelayFields,
  creditsKind?: string | null,
): Promise<void> {
  await finalizeCartOrderCheckout(admin, {
    userId,
    cartId,
    checkoutSessionId: CART_ORDER_WALLET_ONLY_CHECKOUT_SESSION_ID,
    walletIdempotencyKey: cartOrderWalletDebitIdempotencyKey(cartId),
    walletMetadata: {
      exchange_credits_kind: creditsKind ?? null,
      checkout_mode: "wallet_only",
    },
    deliveryChannel,
    relayPointId,
    deliveryLine1,
    returnRelay,
  });
}

export function cartOrderStripeInvoiceCheckoutSessionId(invoiceId: string): string {
  return `inv_${invoiceId.trim()}`;
}

function resolvePaymentIntentIdFromCheckoutSession(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === "string") return pi;
  if (pi && typeof pi === "object" && "id" in pi) return String((pi as { id: string }).id);
  return null;
}

function resolvePaymentIntentIdFromStripeInvoice(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as Stripe.Invoice & { payment_intent?: string | { id: string } | null })
    .payment_intent;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) return String(legacy.id);
  return null;
}

async function confirmCartPaidFromCheckoutMetadata(
  admin: AdminClientWithTable,
  params: {
    userId: string;
    cartId: string;
    checkoutSessionId: string;
    paymentIntentId: string | null;
    stripeCustomerId: string | null;
    metadata: Stripe.Metadata | null | undefined;
  },
): Promise<{ alreadyConfirmed?: boolean }> {
  const meta = params.metadata;
  const isPurchase = meta?.purchase_mode === "true";
  const deliveryChannel = meta?.delivery_channel === "home" ? "home" : "relay";
  const relayPointId = (meta?.relay_code ?? "").trim();
  const deliveryLine1 = (meta?.delivery_line1 ?? "").trim();
  const returnRelayPointId = isPurchase ? "" : (meta?.return_relay_code ?? "").trim();
  const returnRelayLabel = isPurchase ? "" : (meta?.return_relay_label ?? "").trim();
  const returnRelaySearchPostalCode = isPurchase ? "" : (meta?.return_relay_search_postal_code ?? "").trim();
  const creditsKind = meta?.exchange_credits_kind ?? null;
  const missingRaw = Number(meta?.missing_exchange_mods ?? 0);
  const stripeCompPoints = Number.isFinite(missingRaw) ? Math.max(0, Math.trunc(missingRaw)) : 0;
  const usedIncludedOrder = meta?.used_included_order === "true";

  const { alreadyConfirmed } = await finalizeCartOrderCheckout(admin, {
    userId: params.userId,
    cartId: params.cartId,
    checkoutSessionId: params.checkoutSessionId,
    walletIdempotencyKey: cartOrderWalletDebitIdempotencyKey(params.cartId),
    walletMetadata: {
      exchange_credits_kind: creditsKind,
      stripe_wallet_comp_points: stripeCompPoints,
      stripe_wallet_comp_credits_kind: stripeCompPoints > 0 ? "consumption" : null,
      stripe_customer_id: params.stripeCustomerId,
      stripe_checkout_session_id: params.checkoutSessionId,
      stripe_payment_intent_id: params.paymentIntentId,
      used_included_order: usedIncludedOrder,
      purchase_mode: isPurchase,
    },
    deliveryChannel,
    relayPointId,
    deliveryLine1,
    returnRelay:
      returnRelayPointId || returnRelayLabel || returnRelaySearchPostalCode
        ? {
            returnRelayPointId,
            returnRelayLabel,
            returnRelaySearchPostalCode,
          }
        : undefined,
  });

  if (isPurchase) {
    try {
      await admin
        .from("carts")
        .update({ checkout_purchase_mode: true })
        .eq("id", params.cartId);
    } catch (e) {
      console.error("[cart-order] checkout_purchase_mode update failed", params.cartId, e);
    }
  }

  const homeSpeed = (meta?.home_speed ?? "").trim() || null;
  await finalizeCartOutboundSendcloudAfterConfirm(admin, {
    cartId: params.cartId,
    deliveryChannel,
    homeSpeed,
    sendcloudOutbound: sendcloudOutboundFromStripeMetadata(meta),
  });

  await finalizeCoursierExpressHomeAfterConfirm(admin as unknown as SupabaseClient, {
    cartId: params.cartId,
    stripeMetadata: meta,
    deliveryChannel,
    homeSpeed,
  });

  return { alreadyConfirmed };
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
  if (!isCartOrderCheckoutKind(session.metadata?.checkout_kind)) {
    return { ok: true, skipped: true };
  }

  if (!isCartOrderStripeCheckoutPaid(session)) {
    return { ok: true, skipped: true };
  }

  const cartId = session.metadata?.cart_id?.trim();
  if (!cartId) {
    throw new Error("cart_order: metadata cart_id manquant");
  }

  const stripe = new StripeLib(getStripeConfig().secretKey);
  const resolvedSession = await resolveGuestPurchaseCheckoutSession(stripe, session);

  const { alreadyConfirmed } = await confirmCartPaidFromCheckoutMetadata(admin, {
    userId,
    cartId,
    checkoutSessionId: resolvedSession.id,
    paymentIntentId: resolvePaymentIntentIdFromCheckoutSession(resolvedSession),
    stripeCustomerId: typeof resolvedSession.customer === "string" ? resolvedSession.customer : null,
    metadata: resolvedSession.metadata,
  });

  try {
    await upsertCartOrderStripeInvoiceFromSession(admin, resolvedSession, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[cart-order] cart_order_stripe_invoices upsert failed", msg);
  }

  if (checkoutSessionIsGuestPurchase(resolvedSession)) {
    try {
      await issueGuestPurchaseStripeInvoiceAfterCheckoutPayment(
        admin as unknown as Parameters<typeof issueGuestPurchaseStripeInvoiceAfterCheckoutPayment>[0],
        resolvedSession,
        userId,
      );
    } catch (e) {
      console.error("[cart-order] issueGuestPurchaseStripeInvoiceAfterCheckoutPayment", e);
    }
  }

  return { ok: true, alreadyConfirmed };
}

/** Achat Guest : confirmation après facture Stripe Billing payée. */
export async function confirmCartPaidFromStripeInvoice(
  admin: AdminClientWithTable,
  invoice: Stripe.Invoice,
  userId: string,
): Promise<{ ok: boolean; alreadyConfirmed?: boolean; skipped?: boolean }> {
  if (invoice.metadata?.source !== "guest_purchase") {
    return { ok: true, skipped: true };
  }
  if (invoice.metadata?.checkout_kind !== "cart_order") {
    return { ok: true, skipped: true };
  }
  if (invoice.status !== "paid") {
    return { ok: true, skipped: true };
  }

  const cartId = invoice.metadata?.cart_id?.trim();
  if (!cartId) {
    throw new Error("guest_purchase: metadata cart_id manquant");
  }

  const { alreadyConfirmed } = await confirmCartPaidFromCheckoutMetadata(admin, {
    userId,
    cartId,
    checkoutSessionId: cartOrderStripeInvoiceCheckoutSessionId(invoice.id),
    paymentIntentId: resolvePaymentIntentIdFromStripeInvoice(invoice),
    stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
    metadata: invoice.metadata,
  });

  try {
    await upsertCartOrderStripeInvoiceFromStripeInvoice(admin, invoice, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[cart-order] cart_order_stripe_invoices upsert (invoice) failed", msg);
  }

  return { ok: true, alreadyConfirmed };
}
