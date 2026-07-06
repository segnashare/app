import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { provisionCartReturnSendcloudOrder } from "@/lib/cart/provision-cart-return-sendcloud-order";

export function metadataIndicatesCoursierCheckout(
  meta: Record<string, unknown> | null | undefined,
): boolean {
  if (!meta || typeof meta !== "object") return false;
  if (String(meta.coursier_slot_key ?? "").trim()) return true;
  if (String(meta.coursier_service_id ?? "").trim()) return true;
  if (String(meta.coursier_pickup_start ?? "").trim()) return true;
  if (String(meta.coursier_booking_mission_number ?? "").trim()) return true;
  return false;
}

export function stripeSessionIndicatesCoursierCheckout(
  meta: Stripe.Metadata | null | undefined,
): boolean {
  if (!meta) return false;
  return metadataIndicatesCoursierCheckout(meta as unknown as Record<string, unknown>);
}

/** Express domicile legacy Uber (retour MR membre) — pas Coursier ni Sendcloud retour. */
export function shouldSkipSendcloudReturnForLegacyUberMr(params: {
  deliveryChannel?: string | null;
  homeSpeed?: string | null;
  destinationMetadata?: Record<string, unknown> | null;
}): boolean {
  const ch = (params.deliveryChannel ?? "").trim().toLowerCase();
  if (ch !== "home") return false;
  const hs = (params.homeSpeed ?? "").trim().toLowerCase();
  if (hs !== "uber_direct" && hs !== "priority") return false;
  return !metadataIndicatesCoursierCheckout(params.destinationMetadata);
}

function metaStr(meta: Stripe.Metadata | null | undefined, key: string): string {
  return String(meta?.[key] ?? "").trim();
}

/** Persiste le créneau Coursier choisi au checkout (détection BO / retour Chronopost). */
export async function persistCoursierCheckoutMetaFromStripeSession(
  admin: SupabaseClient,
  cartId: string,
  meta: Stripe.Metadata | null | undefined,
): Promise<void> {
  if (!stripeSessionIndicatesCoursierCheckout(meta)) return;

  const { data: ship } = await admin
    .from("shipments")
    .select("id")
    .eq("cart_id", cartId.trim())
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ship?.id) return;

  const { data: dest } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", ship.id)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!dest?.id) return;

  const prev =
    dest.metadata && typeof dest.metadata === "object" && !Array.isArray(dest.metadata)
      ? (dest.metadata as Record<string, unknown>)
      : {};

  const patch: Record<string, unknown> = {
    checkout_delivery_channel: "home",
    checkout_home_speed: metaStr(meta, "home_speed") || "uber_direct",
  };
  for (const key of [
    "coursier_slot_key",
    "coursier_service_id",
    "coursier_pickup_start",
    "coursier_delivery_start",
    "coursier_delivery_end",
  ] as const) {
    const v = metaStr(meta, key);
    if (v) patch[key] = v;
  }

  await admin
    .from("shipment_destinations")
    .update({ metadata: { ...prev, ...patch } })
    .eq("id", dest.id);
}

export async function assignCoursierProviderToOutboundShipment(
  admin: SupabaseClient,
  cartId: string,
): Promise<void> {
  const { data: ship } = await admin
    .from("shipments")
    .select("id")
    .eq("cart_id", cartId.trim())
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ship?.id) return;

  await admin.rpc("set_shipment_provider", {
    p_shipment_id: String(ship.id),
    p_provider_code: "coursier",
  });
}

/** Express domicile : retour Chronopost importé dès confirmation (pas d’étiquette aller Sendcloud). */
export async function finalizeCoursierExpressHomeAfterConfirm(
  admin: SupabaseClient,
  params: {
    cartId: string;
    stripeMetadata: Stripe.Metadata | null | undefined;
    deliveryChannel: "relay" | "home";
    homeSpeed?: string | null;
  },
): Promise<void> {
  if (params.deliveryChannel !== "home") return;
  if (!stripeSessionIndicatesCoursierCheckout(params.stripeMetadata)) return;

  await persistCoursierCheckoutMetaFromStripeSession(admin, params.cartId, params.stripeMetadata);
  await assignCoursierProviderToOutboundShipment(admin, params.cartId);

  const provisioned = await provisionCartReturnSendcloudOrder(admin, {
    cartId: params.cartId,
    deliveryChannel: "home",
    homeSpeed: params.homeSpeed ?? "uber_direct",
  });
  if (!provisioned.ok) {
    console.error("[cart-order] coursier return provision failed", provisioned.error);
  } else if ("skipped" in provisioned && provisioned.skipped) {
    console.info("[cart-order] coursier return provision skipped", provisioned.reason);
  } else if ("orderNumber" in provisioned) {
    console.info("[cart-order] coursier return provisioned", provisioned.orderNumber);
  }
}
