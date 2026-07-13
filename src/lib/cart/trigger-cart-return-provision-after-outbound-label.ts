import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartReturnProvisionedForCart } from "@/lib/cart/cart-return-shipment";
import { shouldSkipSendcloudReturnForLegacyUberMr } from "@/lib/cart/coursier-checkout-meta";
import { isGuestPurchaseCartOrder } from "@/lib/cart/guest-purchase-order";
import { provisionCartReturnSendcloudOrder } from "@/lib/cart/provision-cart-return-sendcloud-order";

function parsePositiveInt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function cartOutboundHasSendcloudLabel(
  admin: SupabaseClient,
  outboundShipmentId: string,
  outboundDestMeta: Record<string, unknown>,
  webhookTrackingNumber?: string | null,
): Promise<boolean> {
  if (webhookTrackingNumber?.trim()) return true;
  if (parsePositiveInt(outboundDestMeta.sendcloud_parcel_id) != null) return true;

  const { data: ship } = await admin
    .from("shipments")
    .select("tracking_number")
    .eq("id", outboundShipmentId)
    .maybeSingle();
  if (String((ship as { tracking_number?: string } | null)?.tracking_number ?? "").trim()) {
    return true;
  }

  const { count } = await admin
    .from("shipment_labels")
    .select("id", { count: "exact", head: true })
    .eq("shipment_id", outboundShipmentId);
  return (count ?? 0) > 0;
}

async function resolveCartDeliveryChannel(
  admin: SupabaseClient,
  cartId: string,
): Promise<{ deliveryChannel: "relay" | "home"; homeSpeed: string | null }> {
  const { data: inv } = await admin
    .from("cart_order_stripe_invoices")
    .select("checkout_delivery_channel, checkout_home_speed")
    .eq("cart_id", cartId)
    .maybeSingle();

  const row = inv as { checkout_delivery_channel?: string | null; checkout_home_speed?: string | null } | null;
  const ch = (row?.checkout_delivery_channel ?? "").trim().toLowerCase();
  const deliveryChannel: "relay" | "home" = ch === "home" ? "home" : "relay";
  const homeSpeed = (row?.checkout_home_speed ?? "").trim() || null;
  if (ch || homeSpeed) {
    return { deliveryChannel, homeSpeed };
  }

  const { data: outShip } = await admin
    .from("shipments")
    .select("shipment_destinations(destination_type, metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const destEmb = (outShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const dest = Array.isArray(destEmb) ? destEmb[0] : destEmb;
  const destType = String((dest as { destination_type?: string } | null)?.destination_type ?? "").toLowerCase();
  const meta =
    dest && typeof dest === "object" && "metadata" in dest && dest.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};
  const metaChannel = String(meta.checkout_delivery_channel ?? "").trim().toLowerCase();
  const metaHomeSpeed = String(meta.checkout_home_speed ?? "").trim() || null;

  return {
    deliveryChannel: metaChannel === "home" || destType === "home" ? "home" : "relay",
    homeSpeed: metaHomeSpeed,
  };
}

/**
 * Après création de l’étiquette aller (webhook Sendcloud) : provisionne la commande retour importée.
 */
export async function triggerCartReturnProvisionAfterOutboundLabel(
  admin: SupabaseClient,
  cartId: string,
  options?: { source?: string; webhookTrackingNumber?: string | null },
): Promise<{ triggered: boolean; skipped?: string; orderNumber?: string; error?: string }> {
  const trimmedCartId = cartId.trim();
  if (!trimmedCartId) return { triggered: false, skipped: "cart_id_missing" };

  const { data: cart } = await admin
    .from("carts")
    .select("status")
    .eq("id", trimmedCartId)
    .is("deleted_at", null)
    .maybeSingle();
  const cartStatus = String((cart as { status?: string } | null)?.status ?? "").toLowerCase();
  if (cartStatus !== "confirmed") {
    return { triggered: false, skipped: "cart_not_confirmed" };
  }

  if (await isGuestPurchaseCartOrder(admin, trimmedCartId)) {
    return { triggered: false, skipped: "guest_purchase" };
  }

  if (await isCartReturnProvisionedForCart(admin, trimmedCartId)) {
    return { triggered: false, skipped: "already_provisioned" };
  }

  const { data: outShip } = await admin
    .from("shipments")
    .select("id, tracking_number, shipment_destinations(metadata)")
    .eq("cart_id", trimmedCartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!outShip?.id) {
    return { triggered: false, skipped: "no_outbound_shipment" };
  }

  const outDestEmb = (outShip as { shipment_destinations?: unknown }).shipment_destinations;
  const outDest = Array.isArray(outDestEmb) ? outDestEmb[0] : outDestEmb;
  const outboundDestMeta =
    outDest && typeof outDest === "object" && "metadata" in outDest && outDest.metadata && typeof outDest.metadata === "object"
      ? (outDest.metadata as Record<string, unknown>)
      : {};

  const hasOutboundLabel = await cartOutboundHasSendcloudLabel(
    admin,
    String(outShip.id),
    outboundDestMeta,
    options?.webhookTrackingNumber ?? (outShip as { tracking_number?: string | null }).tracking_number,
  );
  if (!hasOutboundLabel) {
    return { triggered: false, skipped: "outbound_label_missing" };
  }

  const { deliveryChannel, homeSpeed } = await resolveCartDeliveryChannel(admin, trimmedCartId);
  if (shouldSkipSendcloudReturnForLegacyUberMr({ deliveryChannel, homeSpeed })) {
    return { triggered: false, skipped: "uber_direct" };
  }

  const result = await provisionCartReturnSendcloudOrder(admin, {
    cartId: trimmedCartId,
    deliveryChannel,
    homeSpeed,
  });

  if (!result.ok) {
    console.error("[cart-return-provision] after outbound label failed", {
      cartId: trimmedCartId,
      source: options?.source,
      error: result.error,
    });
    return { triggered: false, error: result.error };
  }

  if ("skipped" in result && result.skipped) {
    return { triggered: false, skipped: result.reason };
  }

  if ("orderNumber" in result) {
    console.info("[cart-return-provision] after outbound label", {
      cartId: trimmedCartId,
      orderNumber: result.orderNumber,
      source: options?.source,
    });
    return { triggered: true, orderNumber: result.orderNumber };
  }

  return { triggered: false, skipped: "unknown" };
}
