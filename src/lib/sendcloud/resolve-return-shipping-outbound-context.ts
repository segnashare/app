import type { SupabaseClient } from "@supabase/supabase-js";

import {
  checkoutMetaIndicatesUberDirect,
  isUberCartOutboundShipment,
} from "@/lib/cart/cart-outbound-delivery-kind";
import { readSendcloudOutboundMetaFromRecord } from "@/lib/cart/checkout-sendcloud-outbound-option";
import { parseSendcloudRelayPointRef } from "@/lib/sendcloud/relay-point-ref";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";

export type ReturnShippingOutboundContext = {
  checkoutDeliveryChannel?: string | null;
  checkoutHomeSpeed?: string | null;
  outboundProviderCode?: string | null;
  memberTrackingUrl?: string | null;
  trackingNumber?: string | null;
  destinationType?: string | null;
  relayCode?: string | null;
  line1?: string | null;
  destMetadata?: Record<string, unknown> | null;
  hubPostalCode?: string;
  weightGrams?: number;
};

export type ReturnShippingRoute = "home_or_uber" | "relay";

function isCartOutboundHomeDestination(
  dest: Record<string, unknown> | null | undefined,
): boolean {
  if (!dest || typeof dest !== "object") return false;
  const t = String(dest.destination_type ?? "").toLowerCase();
  if (t === "home") return true;
  if (t === "pickup_point") return false;
  const relay =
    typeof dest.provider_point_id === "string" && dest.provider_point_id.trim().length > 0;
  if (relay) return false;
  return typeof dest.line1 === "string" && dest.line1.trim().length > 0;
}

function normalizeCarrierSlug(raw: string): string | null {
  const c = raw.trim().toLowerCase();
  if (!c) return null;
  if (c.includes("chrono")) return "chronopost";
  if (c.includes("mondial")) return "mondial_relay";
  if (c.includes("colissimo")) return "colissimo";
  if (c.includes("dhl")) return "dhl";
  if (c.includes("ups")) return "ups";
  if (c.includes("dpd")) return "dpd";
  return c.replace(/\s+/g, "_");
}

function resolveOutboundShipmentProviderCode(input: {
  destMetadata?: Record<string, unknown> | null;
  relayCarrier?: string | null;
}): string {
  const checkout = readSendcloudOutboundMetaFromRecord(input.destMetadata);
  const carrier = (
    checkout?.sendcloud_outbound_carrier ||
    input.relayCarrier ||
    checkout?.sendcloud_outbound_method_title ||
    ""
  )
    .toLowerCase()
    .trim();

  if (carrier.includes("chronopost")) return "chronopost";
  if (carrier.includes("mondial")) return "mondial_relay";
  if (carrier.includes("colissimo")) return "colissimo";
  if (carrier.includes("dhl")) return "dhl";
  if (carrier.includes("ups")) return "ups";
  if (carrier.includes("dpd")) return "dpd";
  return "sendcloud";
}

export function isReturnShippingHomeOrUber(ctx: ReturnShippingOutboundContext): boolean {
  if (
    checkoutMetaIndicatesUberDirect(ctx.checkoutDeliveryChannel, ctx.checkoutHomeSpeed) ||
    isUberCartOutboundShipment({
      outboundProviderCode: ctx.outboundProviderCode,
      memberTrackingUrl: ctx.memberTrackingUrl,
      trackingNumber: ctx.trackingNumber,
    })
  ) {
    return true;
  }

  if ((ctx.checkoutDeliveryChannel ?? "").trim().toLowerCase() === "home") {
    return true;
  }

  return isCartOutboundHomeDestination({
    destination_type: ctx.destinationType,
    provider_point_id: ctx.relayCode,
    line1: ctx.line1,
  });
}

export function classifyReturnShippingRoute(ctx: ReturnShippingOutboundContext): ReturnShippingRoute {
  if (isReturnShippingHomeOrUber(ctx)) return "home_or_uber";
  const relay = (ctx.relayCode ?? "").trim();
  if (relay) return "relay";
  return "home_or_uber";
}

export function inferOutboundRelayCarrierSlug(ctx: ReturnShippingOutboundContext): string | null {
  const checkout = readSendcloudOutboundMetaFromRecord(ctx.destMetadata);
  const fromCheckout = checkout?.sendcloud_outbound_carrier?.trim();
  if (fromCheckout) {
    return normalizeCarrierSlug(fromCheckout);
  }

  const parsed = parseSendcloudRelayPointRef(ctx.relayCode ?? "");
  const relayCarrier = parsed?.carrier ?? null;

  const provider = resolveOutboundShipmentProviderCode({
    destMetadata: ctx.destMetadata,
    relayCarrier,
  });
  if (provider === "sendcloud") {
    return relayCarrier ? normalizeCarrierSlug(relayCarrier) : null;
  }
  return normalizeCarrierSlug(provider);
}

export async function loadReturnShippingOutboundContextForCart(
  admin: SupabaseClient,
  cartId: string,
  hubPostalCode: string,
  itemCount: number,
): Promise<ReturnShippingOutboundContext | null> {
  const { data: outShip } = await admin
    .from("shipments")
    .select(
      "tracking_number, member_tracking_url, provider_id, shipment_destinations ( destination_type, provider_point_id, line1, metadata ), shipment_providers ( code )",
    )
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!outShip) return null;

  const { data: inv } = await admin
    .from("cart_order_stripe_invoices")
    .select("checkout_delivery_channel, checkout_home_speed")
    .eq("cart_id", cartId)
    .maybeSingle();

  const destEmb = (outShip as { shipment_destinations?: unknown }).shipment_destinations;
  const destRows = Array.isArray(destEmb) ? destEmb : destEmb ? [destEmb] : [];
  const dest = (destRows[0] ?? null) as Record<string, unknown> | null;

  const providersEmb = (outShip as { shipment_providers?: unknown }).shipment_providers;
  const providerRow = Array.isArray(providersEmb) ? providersEmb[0] : providersEmb;
  const providerCode =
    providerRow && typeof providerRow === "object"
      ? String((providerRow as { code?: string }).code ?? "").trim().toLowerCase() || null
      : null;

  const invRow = inv as {
    checkout_delivery_channel?: string | null;
    checkout_home_speed?: string | null;
  } | null;

  return {
    checkoutDeliveryChannel: invRow?.checkout_delivery_channel ?? null,
    checkoutHomeSpeed: invRow?.checkout_home_speed ?? null,
    outboundProviderCode: providerCode,
    memberTrackingUrl:
      typeof (outShip as { member_tracking_url?: string }).member_tracking_url === "string"
        ? (outShip as { member_tracking_url: string }).member_tracking_url
        : null,
    trackingNumber:
      typeof (outShip as { tracking_number?: string }).tracking_number === "string"
        ? (outShip as { tracking_number: string }).tracking_number
        : null,
    destinationType: typeof dest?.destination_type === "string" ? dest.destination_type : null,
    relayCode: typeof dest?.provider_point_id === "string" ? dest.provider_point_id : null,
    line1: typeof dest?.line1 === "string" ? dest.line1 : null,
    destMetadata: (dest?.metadata as Record<string, unknown> | undefined) ?? null,
    hubPostalCode,
    weightGrams: exchangeShippingWeightGrams(itemCount),
  };
}
