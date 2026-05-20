import type { SupabaseClient } from "@supabase/supabase-js";

import { isIntakeMemberReturnTrackingNumber } from "@/lib/items/intake-shipping-metadata";
import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { buildSendcloudOrderNumber, parseSendcloudParcelIdFromLabelUrl } from "@/lib/sendcloud/parcel-sync";
import { buildSendcloudV3ParcelLabelUrl } from "@/lib/sendcloud/label-url";
import {
  extractSendcloudLabelUrl,
  extractSendcloudOrderNumber,
  extractSendcloudParcelId,
  extractSendcloudTracking,
  type SendcloudWebhookPayload,
} from "@/lib/sendcloud/sendcloud-webhook-payload";
import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";

export type ResolvedWebhookShipment = {
  id: string;
  status: string;
  context: string;
  tracking_number: string | null;
  member_tracking_url: string | null;
};

export async function findCartIdBySendcloudOutboundOrderNumber(
  admin: SupabaseClient,
  orderNumber: string,
): Promise<string | null> {
  const on = orderNumber.trim();
  if (!on) return null;

  const { data: cart } = await admin
    .from("carts")
    .select("id")
    .eq("sendcloud_outbound_order_number", on)
    .is("deleted_at", null)
    .maybeSingle();

  if (cart?.id) return String(cart.id);

  const { data: destRows } = await admin
    .from("shipment_destinations")
    .select("shipments!inner(cart_id, context, deleted_at)")
    .eq("metadata->>sendcloud_order_number", on)
    .eq("shipments.context", "cart_outbound")
    .is("shipments.deleted_at", null)
    .limit(3);

  for (const row of destRows ?? []) {
    const ship = (row as { shipments?: { cart_id?: string } }).shipments;
    const cartId = ship?.cart_id ? String(ship.cart_id) : "";
    if (cartId) return cartId;
  }

  return null;
}

async function loadOutboundDestMeta(
  admin: SupabaseClient,
  cartId: string,
): Promise<Record<string, unknown>> {
  const { data: outShip } = await admin
    .from("shipments")
    .select("shipment_destinations(metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const destEmb = (outShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const dest = Array.isArray(destEmb) ? destEmb[0] : destEmb;
  return dest && typeof dest === "object" && "metadata" in dest && dest.metadata && typeof dest.metadata === "object"
    ? (dest.metadata as Record<string, unknown>)
    : {};
}

function parsePositiveInt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function loadOutboundParcelIdForCart(
  admin: SupabaseClient,
  cartId: string,
): Promise<number | null> {
  const meta = await loadOutboundDestMeta(admin, cartId);
  return parsePositiveInt(meta.sendcloud_parcel_id);
}

async function loadDummyPortalParcelIdForCart(
  admin: SupabaseClient,
  cartId: string,
): Promise<number | null> {
  const meta = await loadOutboundDestMeta(admin, cartId);
  return parsePositiveInt(meta.sc_cart_return_dummy_parcel_id);
}

async function loadReturnParcelIdForCart(
  admin: SupabaseClient,
  cartId: string,
): Promise<number | null> {
  const { data: retShip } = await admin
    .from("shipments")
    .select("shipment_destinations(metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const destEmb = (retShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const dest = Array.isArray(destEmb) ? destEmb[0] : destEmb;
  const meta =
    dest && typeof dest === "object" && "metadata" in dest && dest.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};
  return parsePositiveInt(meta.sendcloud_parcel_id);
}

async function loadOutboundLabelParcelId(
  admin: SupabaseClient,
  outboundShipmentId: string,
): Promise<number | null> {
  const { data: labels } = await admin
    .from("shipment_labels")
    .select("label_url")
    .eq("shipment_id", outboundShipmentId)
    .order("created_at", { ascending: false })
    .limit(1);
  const url = String((labels?.[0] as { label_url?: string } | undefined)?.label_url ?? "").trim();
  return url ? parseSendcloudParcelIdFromLabelUrl(url) : null;
}

async function outboundShipmentHasLabel(admin: SupabaseClient, outboundShipmentId: string): Promise<boolean> {
  const { count } = await admin
    .from("shipment_labels")
    .select("id", { count: "exact", head: true })
    .eq("shipment_id", outboundShipmentId);
  return (count ?? 0) > 0;
}

/** Lie le colis Sendcloud aller en metadata dès le 1er webhook (évite de créer un faux retour). */
async function linkOutboundSendcloudParcelIdIfMissing(
  admin: SupabaseClient,
  cartId: string,
  parcelId: number,
): Promise<void> {
  const existing = await loadOutboundParcelIdForCart(admin, cartId);
  if (existing != null) return;

  const { data: dest } = await admin
    .from("shipments")
    .select("shipment_destinations(id, metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const destEmb = (dest as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const row = Array.isArray(destEmb) ? destEmb[0] : destEmb;
  const destId = (row as { id?: string } | null)?.id;
  if (!destId) return;

  const prev =
    row && typeof row === "object" && "metadata" in row && row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};

  await admin
    .from("shipment_destinations")
    .update({
      metadata: { ...prev, sendcloud_parcel_id: parcelId },
    })
    .eq("id", destId);
}

/**
 * Webhook dont le n° de commande est celui de l’**aller** : ne provisionner un `cart_return`
 * que si le colis est clairement distinct du colis aller (portail retour membre, etc.).
 */
function shouldProvisionCartReturnFromOutboundOrderWebhook(params: {
  parcelId: number | null;
  outboundParcelId: number | null;
  dummyParcelId: number | null;
  returnParcelId: number | null;
  outboundLabelParcelId: number | null;
  outboundHasLabel: boolean;
}): boolean {
  const { parcelId, outboundParcelId, dummyParcelId, returnParcelId, outboundLabelParcelId, outboundHasLabel } =
    params;

  if (parcelId == null) return false;

  if (dummyParcelId != null && parcelId === dummyParcelId) return false;
  if (outboundParcelId != null && parcelId === outboundParcelId) return false;
  if (returnParcelId != null && parcelId === returnParcelId) return true;

  // Premier webhook aller (parcel_id pas encore en base) → jamais un retour.
  if (!outboundHasLabel) return false;

  if (outboundLabelParcelId != null && parcelId === outboundLabelParcelId) return false;
  if (outboundParcelId != null && parcelId !== outboundParcelId) return true;

  return (
    outboundHasLabel && outboundLabelParcelId != null && parcelId !== outboundLabelParcelId
  );
}

async function findCartReturnShipment(
  admin: SupabaseClient,
  cartId: string,
): Promise<ResolvedWebhookShipment | null> {
  const { data: ship } = await admin
    .from("shipments")
    .select("id, status, context, tracking_number, member_tracking_url")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ship?.id) return null;
  return ship as ResolvedWebhookShipment;
}

async function findOutboundShipment(
  admin: SupabaseClient,
  cartId: string,
): Promise<ResolvedWebhookShipment | null> {
  const { data: ship } = await admin
    .from("shipments")
    .select("id, status, context, tracking_number, member_tracking_url")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ship?.id) return null;
  return ship as ResolvedWebhookShipment;
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

export async function ensureCartReturnShipmentFromSendcloudWebhook(
  admin: SupabaseClient,
  env: SendcloudEnv | null,
  params: {
    cartId: string;
    parcelId: number | null;
    orderNumber: string;
    trackingNumber: string | null;
    trackingUrl: string | null;
    labelUrl: string | null;
    source: string;
  },
): Promise<
  | { ok: true; shipment: ResolvedWebhookShipment; created: boolean; transitionedToReady: boolean }
  | { ok: false; error: string }
> {
  const cartId = params.cartId.trim();
  let returnShip = await findCartReturnShipment(admin, cartId);
  let created = false;

  if (!returnShip) {
    const { data: inserted, error: insErr } = await admin
      .from("shipments")
      .insert({ cart_id: cartId, context: "cart_return", status: "pending" })
      .select("id, status, context, tracking_number, member_tracking_url")
      .single();
    if (insErr || !inserted?.id) {
      return { ok: false, error: insErr?.message ?? "Création shipment retour impossible." };
    }
    returnShip = inserted as ResolvedWebhookShipment;
    created = true;
  }

  const parcelId = params.parcelId;
  const orderNumber = params.orderNumber.trim();
  const returnOrderNumber =
    orderNumber ||
    buildSendcloudOrderNumber({
      cartId,
      shipmentId: returnShip.id,
      generation: 1,
    });

  let labelUrl = params.labelUrl?.trim() ?? "";
  if (!labelUrl && parcelId && env) {
    labelUrl = buildSendcloudV3ParcelLabelUrl(env, parcelId);
  }
  if (!labelUrl && params.labelUrl) {
    labelUrl = params.labelUrl;
  }

  const metaPatch: Record<string, unknown> = {
    sendcloud_order_number: returnOrderNumber,
    sc_sendcloud_return_source: params.source,
    sc_sendcloud_return_synced_at: new Date().toISOString(),
  };
  if (parcelId) {
    metaPatch.sendcloud_parcel_id = parcelId;
  }

  await ensureCartReturnDestination(admin, returnShip.id, cartId, metaPatch);

  if (parcelId) {
    const { data: outShip } = await admin
      .from("shipments")
      .select("id, shipment_destinations(id, metadata)")
      .eq("cart_id", cartId)
      .eq("context", "cart_outbound")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    const destEmb = (outShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
    const dest = Array.isArray(destEmb) ? destEmb[0] : destEmb;
    const destId = (dest as { id?: string } | null)?.id;
    const prevMeta =
      dest && typeof dest === "object" && "metadata" in dest && dest.metadata && typeof dest.metadata === "object"
        ? (dest.metadata as Record<string, unknown>)
        : {};
    if (destId) {
      await admin
        .from("shipment_destinations")
        .update({
          metadata: {
            ...prevMeta,
            sc_cart_return_sendcloud_parcel_id: parcelId,
            sc_cart_return_shipment_id: returnShip.id,
          },
        })
        .eq("id", destId);
    }
  }

  const { error: providerErr } = await admin.rpc("set_shipment_provider", {
    p_shipment_id: returnShip.id,
    p_provider_code: "sendcloud",
  });
  if (providerErr) {
    console.warn("[cart-return-webhook] set_shipment_provider", providerErr.message);
  }

  const trackingNumber = params.trackingNumber?.trim() || null;
  const trackingUrl = params.trackingUrl?.trim() || null;
  await admin
    .from("shipments")
    .update({
      ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
      ...(trackingUrl ? { member_tracking_url: trackingUrl } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", returnShip.id);

  if (labelUrl.startsWith("http")) {
    const { count } = await admin
      .from("shipment_labels")
      .select("id", { count: "exact", head: true })
      .eq("shipment_id", returnShip.id);
    if (!count) {
      await admin.from("shipment_labels").insert({
        shipment_id: returnShip.id,
        label_url: labelUrl,
        label_format: "pdf",
        label_status: "created",
      });
    }
  }

  let transitionedToReady = false;
  const st = returnShip.status.toLowerCase();
  if (st === "pending") {
    const tr = await transitionShipmentStatus(admin, {
      shipmentId: returnShip.id,
      ifCurrentStatus: "pending",
      toStatus: "ready",
      actorUserId: null,
      reason: "Sendcloud : retour créé (portail / webhook)",
      source: params.source,
      context: {
        parcel_id: parcelId,
        order_number: returnOrderNumber,
        cart_id: cartId,
      },
      trackingNumber,
    });
    if (tr.ok) {
      transitionedToReady = true;
      returnShip = { ...returnShip, status: "ready", tracking_number: trackingNumber ?? returnShip.tracking_number };
    }
  }

  return { ok: true, shipment: returnShip, created, transitionedToReady };
}

async function loadShipmentById(
  admin: SupabaseClient,
  shipmentId: string,
): Promise<ResolvedWebhookShipment | null> {
  const { data: ship } = await admin
    .from("shipments")
    .select("id, status, context, tracking_number, member_tracking_url")
    .eq("id", shipmentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!ship?.id) return null;
  return ship as ResolvedWebhookShipment;
}

export async function findShipmentBySendcloudParcelIdExtended(
  admin: SupabaseClient,
  parcelId: number,
): Promise<ResolvedWebhookShipment | null> {
  const pid = String(parcelId);

  const { data: byReturnParcelOnOutbound } = await admin
    .from("shipment_destinations")
    .select("metadata")
    .eq("metadata->>sc_cart_return_sendcloud_parcel_id", pid)
    .limit(8);
  for (const row of byReturnParcelOnOutbound ?? []) {
    const meta =
      row && typeof row === "object" && "metadata" in row && row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    const returnShipId =
      typeof meta.sc_cart_return_shipment_id === "string" ? meta.sc_cart_return_shipment_id.trim() : "";
    if (returnShipId) {
      const loaded = await loadShipmentById(admin, returnShipId);
      if (loaded?.context === "cart_return") return loaded;
    }
  }

  const { data: byParcel } = await admin
    .from("shipment_destinations")
    .select("shipment_id")
    .eq("metadata->>sendcloud_parcel_id", pid)
    .limit(8);
  const { data: byReturnParcel } = await admin
    .from("shipment_destinations")
    .select("shipment_id")
    .eq("metadata->>sc_cart_return_sendcloud_parcel_id", pid)
    .limit(8);
  const { data: byPanelShipment } = await admin
    .from("shipment_destinations")
    .select("shipment_id")
    .eq("metadata->>sendcloud_panel_shipment_id", pid)
    .limit(8);
  const { data: byOutgoingParcel } = await admin
    .from("shipment_destinations")
    .select("shipment_id")
    .eq("metadata->>sc_outgoing_parcel_id", pid)
    .limit(8);
  const destRows = [
    ...(byParcel ?? []),
    ...(byReturnParcel ?? []),
    ...(byPanelShipment ?? []),
    ...(byOutgoingParcel ?? []),
  ];

  const shipmentIds = [...new Set((destRows ?? []).map((r) => String((r as { shipment_id: string }).shipment_id)))];
  if (shipmentIds.length === 0) return null;

  const { data: ships } = await admin
    .from("shipments")
    .select("id, status, context, tracking_number, member_tracking_url")
    .in("id", shipmentIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  const list = (ships ?? []) as ResolvedWebhookShipment[];
  return (
    list.find((s) => s.context === "member_intake") ??
    list.find((s) => s.context === "cart_return") ??
    list.find((s) => s.context === "cart_outbound") ??
    list[0] ??
    null
  );
}

export async function resolveShipmentForSendcloudWebhook(
  admin: SupabaseClient,
  env: SendcloudEnv | null,
  payload: SendcloudWebhookPayload,
  options: { source: string },
): Promise<
  | { ok: true; shipment: ResolvedWebhookShipment; provisioned?: boolean }
  | { ok: true; notFound: true }
  | { ok: false; error: string }
> {
  const parcelId = extractSendcloudParcelId(payload);
  const orderNumber = extractSendcloudOrderNumber(payload);
  const { trackingNumber, trackingUrl } = extractSendcloudTracking(payload);
  const labelUrl = extractSendcloudLabelUrl(payload);

  if (parcelId) {
    const byParcel = await findShipmentBySendcloudParcelIdExtended(admin, parcelId);
    if (byParcel) {
      return { ok: true, shipment: byParcel };
    }
  }

  if (orderNumber) {
    const cartId = await findCartIdBySendcloudOutboundOrderNumber(admin, orderNumber);
    if (cartId) {
      const outbound = await findOutboundShipment(admin, cartId);
      if (!outbound) {
        return { ok: true, notFound: true };
      }

      const outboundParcelId = await loadOutboundParcelIdForCart(admin, cartId);
      const dummyParcelId = await loadDummyPortalParcelIdForCart(admin, cartId);
      if (parcelId != null && dummyParcelId != null && parcelId === dummyParcelId) {
        return { ok: true, notFound: true };
      }

      const returnParcelId = await loadReturnParcelIdForCart(admin, cartId);
      const hasOutboundLabel = await outboundShipmentHasLabel(admin, outbound.id);
      const outboundLabelParcelId = hasOutboundLabel
        ? await loadOutboundLabelParcelId(admin, outbound.id)
        : null;

      const provisionReturn = shouldProvisionCartReturnFromOutboundOrderWebhook({
        parcelId,
        outboundParcelId,
        dummyParcelId,
        returnParcelId,
        outboundLabelParcelId,
        outboundHasLabel: hasOutboundLabel,
      });

      if (!provisionReturn) {
        if (parcelId != null && outboundParcelId == null) {
          await linkOutboundSendcloudParcelIdIfMissing(admin, cartId, parcelId);
        }
        const existingReturn = await findCartReturnShipment(admin, cartId);
        if (
          existingReturn &&
          parcelId != null &&
          trackingNumber &&
          isIntakeMemberReturnTrackingNumber(trackingNumber)
        ) {
          const ensured = await ensureCartReturnShipmentFromSendcloudWebhook(admin, env, {
            cartId,
            parcelId,
            orderNumber,
            trackingNumber,
            trackingUrl,
            labelUrl,
            source: options.source,
          });
          if (ensured.ok) {
            return {
              ok: true,
              shipment: ensured.shipment,
              provisioned: ensured.created || ensured.transitionedToReady,
            };
          }
        }
        return { ok: true, shipment: outbound };
      }

      const ensured = await ensureCartReturnShipmentFromSendcloudWebhook(admin, env, {
        cartId,
        parcelId,
        orderNumber,
        trackingNumber,
        trackingUrl,
        labelUrl,
        source: options.source,
      });
      if (!ensured.ok) {
        return ensured;
      }
      return { ok: true, shipment: ensured.shipment, provisioned: ensured.created || ensured.transitionedToReady };
    }

    const { data: destRows } = await admin
      .from("shipment_destinations")
      .select("shipment_id")
      .eq("metadata->>sendcloud_order_number", orderNumber.trim())
      .limit(5);

    if (destRows?.length) {
      const shipmentIds = [...new Set(destRows.map((r) => String((r as { shipment_id: string }).shipment_id)))];
      const { data: ships } = await admin
        .from("shipments")
        .select("id, status, context, tracking_number, member_tracking_url")
        .in("id", shipmentIds)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1);
      const ship = (ships?.[0] ?? null) as ResolvedWebhookShipment | null;
      if (ship) {
        return { ok: true, shipment: ship };
      }
    }
  }

  return { ok: true, notFound: true };
}
