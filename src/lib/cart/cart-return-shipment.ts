import type { SupabaseClient } from "@supabase/supabase-js";

import { isIntakeMemberReturnTrackingNumber } from "@/lib/items/intake-shipping-metadata";
import { cancelSendcloudOutboundParcel } from "@/lib/sendcloud/orders-api";
import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { buildSendcloudV3ParcelLabelUrl } from "@/lib/sendcloud/label-url";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";
import { findSendcloudParcelsByOrderNumberV3 } from "@/lib/sendcloud/shipments";
import { ensureCartReturnShipmentFromSendcloudWebhook } from "@/lib/sendcloud/cart-return-sendcloud-webhook";

/** Suivi retour portail Sendcloud (colis retour Chronopost / Mondial Relay). */
export function isCartReturnMemberTrackingNumber(trackingNumber: string | null | undefined): boolean {
  return isIntakeMemberReturnTrackingNumber(trackingNumber);
}

const RESETTABLE_RETURN_STATUSES = new Set(["pending", "ready", "failed"]);

/** Crée ou réutilise l’expédition DB `cart_return` avant ouverture du portail Sendcloud. */
export async function ensureCartReturnShipmentForPortal(
  admin: SupabaseClient,
  cartId: string,
  orderNumber: string,
): Promise<{ ok: true; shipmentId: string; reused: boolean } | { ok: false; error: string }> {
  const { data: existing } = await admin
    .from("shipments")
    .select("id, status")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return { ok: true, shipmentId: String(existing.id), reused: true };
  }

  const { data: inserted, error: insErr } = await admin
    .from("shipments")
    .insert({ cart_id: cartId, context: "cart_return", status: "pending" })
    .select("id")
    .single();

  if (insErr || !inserted?.id) {
    return { ok: false, error: insErr?.message ?? "Création expédition retour impossible." };
  }

  const shipmentId = String(inserted.id);

  const { error: providerErr } = await admin.rpc("set_shipment_provider", {
    p_shipment_id: shipmentId,
    p_provider_code: "sendcloud",
  });
  if (providerErr) {
    console.warn("[cart-return-shipment] set_shipment_provider", providerErr.message);
  }

  const returnOrderNumber =
    orderNumber.trim() ||
    buildSendcloudOrderNumber({
      cartId,
      shipmentId,
      generation: 1,
    });

  await ensureCartReturnDestination(admin, shipmentId, cartId, {
    sendcloud_order_number: returnOrderNumber,
    sc_cart_return_portal_bootstrapped_at: new Date().toISOString(),
  });

  return { ok: true, shipmentId, reused: false };
}

/** Lie l’expédition Sendcloud technique (aller portail) au shipment DB `cart_return`. */
export async function syncCartReturnShipmentPortalIds(
  admin: SupabaseClient,
  params: {
    cartReturnShipmentId: string;
    cartId: string;
    orderNumber: string;
    panelShipmentId: string;
    outboundParcelId?: number | null;
  },
): Promise<void> {
  const sid = params.cartReturnShipmentId.trim();
  if (!sid) return;

  const metaPatch: Record<string, unknown> = {
    sendcloud_order_number: params.orderNumber.trim(),
    sendcloud_panel_shipment_id: params.panelShipmentId.trim(),
    sc_sendcloud_cart_return_portal_synced_at: new Date().toISOString(),
  };
  if (params.outboundParcelId != null && params.outboundParcelId > 0) {
    metaPatch.sc_outgoing_parcel_id = params.outboundParcelId;
  }

  await ensureCartReturnDestination(admin, sid, params.cartId, metaPatch);
}

export async function syncCartReturnShipmentTracking(
  service: SupabaseClient,
  shipmentId: string,
  params: { trackingNumber?: string | null; trackingUrl?: string | null },
): Promise<void> {
  const tn = params.trackingNumber?.trim();
  const url = params.trackingUrl?.trim();
  if (!tn && !url) return;

  await service
    .from("shipments")
    .update({
      ...(tn ? { tracking_number: tn } : {}),
      ...(url ? { member_tracking_url: url } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", shipmentId.trim())
    .eq("context", "cart_return");
}

/** Met à jour le colis retour Sendcloud sur la destination `cart_return`. */
export async function patchCartReturnShipmentReturnParcel(
  service: SupabaseClient,
  shipmentId: string,
  parcelId: number,
): Promise<void> {
  if (!Number.isFinite(parcelId) || parcelId <= 0) return;
  const pid = parcelId;

  const { data: dest } = await service
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", shipmentId.trim())
    .limit(1)
    .maybeSingle();

  if (!dest?.id) return;
  const prev =
    dest.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};
  const existing = prev.sendcloud_parcel_id;
  if (existing === pid || existing === String(pid)) return;

  await service
    .from("shipment_destinations")
    .update({
      metadata: {
        ...prev,
        sendcloud_parcel_id: pid,
        sc_sendcloud_return_parcel_at: new Date().toISOString(),
      },
    })
    .eq("id", dest.id);
}

async function ensureCartReturnDestination(
  admin: SupabaseClient,
  cartReturnShipmentId: string,
  cartId: string,
  metaPatch: Record<string, unknown>,
): Promise<void> {
  const { data: existing } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", cartReturnShipmentId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const prev =
      existing.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, unknown>)
        : {};
    await admin
      .from("shipment_destinations")
      .update({ metadata: { ...prev, ...metaPatch } })
      .eq("id", existing.id);
    return;
  }

  const { data: outDest } = await admin
    .from("shipments")
    .select("shipment_destinations(destination_type, provider_point_id, line1, line2, city, postal_code, phone, metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  const outRow = (outDest as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const template = Array.isArray(outRow) ? outRow[0] : outRow;
  const t = template as
    | {
        destination_type?: string;
        provider_point_id?: string | null;
        line1?: string | null;
        line2?: string | null;
        city?: string | null;
        postal_code?: string | null;
        phone?: string | null;
        metadata?: Record<string, unknown>;
      }
    | undefined;

  await admin.from("shipment_destinations").insert({
    shipment_id: cartReturnShipmentId,
    destination_type: t?.destination_type ?? "pickup_point",
    provider_point_id: t?.provider_point_id ?? null,
    line1: t?.line1 ?? null,
    line2: t?.line2 ?? null,
    city: t?.city ?? null,
    postal_code: t?.postal_code ?? null,
    phone: t?.phone ?? null,
    metadata: { ...(t?.metadata ?? {}), ...metaPatch },
  });
}

/** Réinitialisation portail : conserve le shipment retour, efface suivi / étiquette / colis Sendcloud actifs. */
export async function resetCartReturnShipmentForPortal(
  admin: SupabaseClient,
  cartId: string,
  env: SendcloudEnv,
): Promise<void> {
  const { data: retShip } = await admin
    .from("shipments")
    .select("id, status, shipment_destinations(metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!retShip?.id) return;

  const st = String((retShip as { status?: string }).status ?? "").toLowerCase();
  if (!RESETTABLE_RETURN_STATUSES.has(st)) return;

  const returnShipId = String(retShip.id);
  const destEmb = (retShip as { shipment_destinations?: unknown }).shipment_destinations;
  const dest = Array.isArray(destEmb) ? destEmb[0] : destEmb;
  const meta =
    dest && typeof dest === "object" && "metadata" in dest && dest.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};
  const parcelRaw = meta.sendcloud_parcel_id;
  const parcelId =
    typeof parcelRaw === "number"
      ? parcelRaw
      : typeof parcelRaw === "string"
        ? parseInt(parcelRaw, 10)
        : NaN;
  if (Number.isFinite(parcelId) && parcelId > 0) {
    await cancelSendcloudOutboundParcel(env, parcelId).catch(() => undefined);
  }

  await admin.from("shipment_labels").delete().eq("shipment_id", returnShipId);

  await admin
    .from("shipments")
    .update({
      status: "pending",
      tracking_number: null,
      member_tracking_url: null,
      ready_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", returnShipId);

  if (dest && typeof dest === "object" && "id" in dest && dest.id) {
    const prev = { ...meta };
    delete prev.sendcloud_parcel_id;
    delete prev.sc_outgoing_parcel_id;
    delete prev.sendcloud_panel_shipment_id;
    delete prev.sc_sendcloud_return_source;
    delete prev.sc_sendcloud_return_synced_at;
    delete prev.sc_sendcloud_return_parcel_at;
    delete prev.sc_sendcloud_cart_return_portal_synced_at;
    delete prev.sc_cart_return_portal_bootstrapped_at;
    await admin.from("shipment_destinations").update({ metadata: prev }).eq("id", String(dest.id));
  }
}

const RETURN_DEST_PORTAL_META_KEYS = [
  "sc_cart_return_portal_url",
  "sc_cart_return_portal_identifier",
  "sc_cart_return_portal_postal_code",
  "sc_cart_return_portal_order_number",
  "sc_cart_return_dummy_shipment_id",
  "sc_cart_return_dummy_cancel_after_at",
  "sc_cart_return_dummy_shipment_cancelled_at",
] as const;

/** Efface les métadonnées portail sur la destination `cart_return` (si présente). */
export async function clearCartReturnDestinationPortalMeta(
  admin: SupabaseClient,
  cartReturnShipmentId: string,
): Promise<void> {
  const { data: dest } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", cartReturnShipmentId.trim())
    .limit(1)
    .maybeSingle();
  if (!dest?.id) return;

  const prev =
    dest.metadata && typeof dest.metadata === "object"
      ? { ...(dest.metadata as Record<string, unknown>) }
      : {};
  for (const key of RETURN_DEST_PORTAL_META_KEYS) {
    delete prev[key];
  }
  delete prev.sc_cart_return_sendcloud_parcel_id;
  await admin.from("shipment_destinations").update({ metadata: prev }).eq("id", dest.id);
}

/**
 * Relève côté Sendcloud le colis retour (suivi XT) et l’aligne sur le shipment `cart_return`
 * — même principe que la synchro webhook / intake après portail.
 */
export async function syncCartReturnFromSendcloudByOrder(
  admin: SupabaseClient,
  env: SendcloudEnv,
  params: {
    cartId: string;
    orderNumber: string;
    outboundParcelId?: number | null;
    dummyParcelId?: number | null;
  },
): Promise<{ ok: true; synced: boolean; tracking_number?: string | null } | { ok: false; error: string }> {
  const orderNumber = params.orderNumber.trim();
  if (!orderNumber) {
    return { ok: true, synced: false };
  }

  const parcels = await findSendcloudParcelsByOrderNumberV3(env, orderNumber);
  const exclude = new Set<number>();
  if (params.dummyParcelId != null && params.dummyParcelId > 0) exclude.add(params.dummyParcelId);
  if (params.outboundParcelId != null && params.outboundParcelId > 0) exclude.add(params.outboundParcelId);

  let chosen: (typeof parcels)[number] | null = null;
  for (const parcel of parcels) {
    const id = typeof parcel.id === "number" ? parcel.id : NaN;
    if (!Number.isFinite(id) || id <= 0 || exclude.has(id)) continue;
    const tn = String(parcel.tracking_number ?? "").trim();
    if (isCartReturnMemberTrackingNumber(tn)) {
      chosen = parcel;
      break;
    }
    if (!chosen && tn) {
      chosen = parcel;
    }
  }

  if (!chosen?.id) {
    return { ok: true, synced: false };
  }

  const parcelId = chosen.id as number;
  const trackingNumber = String(chosen.tracking_number ?? "").trim() || null;
  const labelUrl = buildSendcloudV3ParcelLabelUrl(env, parcelId);

  const ensured = await ensureCartReturnShipmentFromSendcloudWebhook(admin, env, {
    cartId: params.cartId,
    parcelId,
    orderNumber,
    trackingNumber,
    trackingUrl: null,
    labelUrl: labelUrl.startsWith("http") ? labelUrl : null,
    source: "member_app_cart_return_portal_sync",
  });
  if (!ensured.ok) {
    return { ok: false, error: ensured.error };
  }

  await patchCartReturnShipmentReturnParcel(admin, ensured.shipment.id, parcelId);
  if (trackingNumber) {
    await syncCartReturnShipmentTracking(admin, ensured.shipment.id, {
      trackingNumber,
      trackingUrl: null,
    });
  }

  return { ok: true, synced: true, tracking_number: trackingNumber };
}
