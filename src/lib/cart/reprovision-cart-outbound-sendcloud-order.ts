import type { SupabaseClient } from "@supabase/supabase-js";

import { checkoutMetaIndicatesUberDirect } from "@/lib/cart/cart-outbound-delivery-kind";
import { readSendcloudOutboundMetaFromRecord } from "@/lib/cart/checkout-sendcloud-outbound-option";
import { cancelCartOutboundSendcloudOrder } from "@/lib/cart/cancel-cart-outbound-sendcloud-order";
import { provisionCartOutboundSendcloudOrder } from "@/lib/cart/provision-cart-outbound-sendcloud-order";
import { getSendcloudEnv } from "@/lib/sendcloud/config";

export type ReprovisionCartOutboundSendcloudOrderResult =
  | { ok: true; skipped: true; reason: string; notices: string[] }
  | {
      ok: true;
      orderNumber: string;
      sendcloudPanelOrderId: string | null;
      generation: number;
      cancelledPrevious: boolean;
      notices: string[];
    }
  | { ok: false; error: string; notices: string[] };

function parseGeneration(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
}

function isHomeDestinationType(raw: unknown): boolean {
  const t = String(raw ?? "").toLowerCase();
  return t === "home" || t.includes("domicile");
}

/**
 * Recréation BO de la commande Sendcloud importée (checkout raté ou commande panel corrompue).
 * Annule l’existant si déjà provisionné, puis reprovisionne (generation +1 si annulation).
 */
export async function reprovisionCartOutboundSendcloudOrder(
  admin: SupabaseClient,
  cartId: string,
): Promise<ReprovisionCartOutboundSendcloudOrderResult> {
  const notices: string[] = [];
  const trimmedCartId = cartId.trim();

  if (!getSendcloudEnv()) {
    return { ok: false, error: "sendcloud_not_configured", notices };
  }

  const { data: cartRow, error: cartErr } = await admin
    .from("carts")
    .select("id, status")
    .eq("id", trimmedCartId)
    .is("deleted_at", null)
    .maybeSingle();

  if (cartErr) {
    return { ok: false, error: "cart_read_failed", notices };
  }

  const cart = cartRow as { status: string } | null;
  if (!cart) {
    return { ok: false, error: "cart_not_found", notices };
  }

  if (cart.status !== "confirmed") {
    return { ok: false, error: "cart_not_confirmed", notices };
  }

  const { data: ship, error: shipErr } = await admin
    .from("shipments")
    .select("id, status")
    .eq("cart_id", trimmedCartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shipErr || !ship?.id) {
    return { ok: false, error: "outbound_shipment_not_found", notices };
  }

  const shipmentStatus = String((ship as { status?: string }).status ?? "").trim();
  if (shipmentStatus !== "pending" && shipmentStatus !== "ready") {
    return { ok: false, error: "outbound_not_reprovisionable", notices };
  }

  const shipmentId = String(ship.id);

  const [{ data: destRow }, { data: invRow }] = await Promise.all([
    admin
      .from("shipment_destinations")
      .select("destination_type, metadata")
      .eq("shipment_id", shipmentId)
      .limit(1)
      .maybeSingle(),
    admin
      .from("cart_order_stripe_invoices")
      .select("checkout_delivery_channel, checkout_home_speed")
      .eq("cart_id", trimmedCartId)
      .maybeSingle(),
  ]);

  const dest = destRow as { destination_type?: string; metadata?: unknown } | null;
  const destMeta =
    dest?.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};

  const inv = invRow as
    | { checkout_delivery_channel?: string | null; checkout_home_speed?: string | null }
    | null;

  const deliveryChannel =
    (inv?.checkout_delivery_channel ?? "").trim().toLowerCase() === "home" ||
    isHomeDestinationType(dest?.destination_type)
      ? ("home" as const)
      : ("relay" as const);
  const homeSpeed = (inv?.checkout_home_speed ?? "").trim() || null;

  if (checkoutMetaIndicatesUberDirect(deliveryChannel, homeSpeed)) {
    return { ok: false, error: "uber_direct_not_supported", notices };
  }

  const checkoutMeta = readSendcloudOutboundMetaFromRecord(destMeta);
  if (!checkoutMeta?.sendcloud_outbound_option_code) {
    return { ok: false, error: "no_sendcloud_outbound_option", notices };
  }

  const currentGeneration = parseGeneration(destMeta.sendcloud_label_generation);
  const wasProvisioned = Boolean(
    destMeta.sendcloud_order_provisioned_at || destMeta.sendcloud_panel_order_id,
  );

  let cancelledPrevious = false;
  let generation = currentGeneration;

  if (wasProvisioned) {
    const cancelRes = await cancelCartOutboundSendcloudOrder(admin, trimmedCartId);
    notices.push(...cancelRes.notices);
    if (!cancelRes.ok) {
      return { ok: false, error: cancelRes.reason ?? "sendcloud_cancel_failed", notices };
    }
    cancelledPrevious = true;
    generation = currentGeneration + 1;
  }

  const provisionRes = await provisionCartOutboundSendcloudOrder(admin, {
    cartId: trimmedCartId,
    deliveryChannel,
    homeSpeed,
    force: true,
    generation,
  });

  if (!provisionRes.ok) {
    return { ok: false, error: provisionRes.error, notices };
  }

  if ("skipped" in provisionRes && provisionRes.skipped) {
    return { ok: true, skipped: true, reason: provisionRes.reason, notices };
  }

  if (!("orderNumber" in provisionRes)) {
    return { ok: false, error: "provision_unexpected_response", notices };
  }

  if (cancelledPrevious) {
    notices.push(`Commande Sendcloud recréée (generation ${generation}).`);
  } else {
    notices.push("Commande Sendcloud créée.");
  }

  return {
    ok: true,
    orderNumber: provisionRes.orderNumber,
    sendcloudPanelOrderId: provisionRes.sendcloudPanelOrderId,
    generation,
    cancelledPrevious,
    notices,
  };
}
