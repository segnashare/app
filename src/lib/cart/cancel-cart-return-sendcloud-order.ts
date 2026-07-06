import type { SupabaseClient } from "@supabase/supabase-js";

import { getSendcloudEnv } from "@/lib/sendcloud/config";
import {
  cancelSendcloudOutboundParcel,
  deleteSendcloudOrder,
  findSendcloudOrderByNumber,
} from "@/lib/sendcloud/orders-api";
import { resolveSendcloudParcelIdFromTracking } from "@/lib/sendcloud/parcel-tracking";
import {
  buildSendcloudOrderNumber,
  fetchSendcloudParcel,
  parseSendcloudParcelIdFromLabelUrl,
} from "@/lib/sendcloud/parcel-sync";
import { resolveSendcloudIntegrationId } from "@/lib/sendcloud/integrations";
import { cancelSendcloudShipment } from "@/lib/sendcloud/return-portal-shipment";
import {
  findSendcloudParcelsByOrderNumberV3,
  findSendcloudShipmentIdsByOrderNumber,
  isSendcloudParcelCancelled,
  type SendcloudShipmentParcel,
} from "@/lib/sendcloud/shipments";

export type CancelCartReturnSendcloudOrderResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  notices: string[];
};

function parseParcelId(raw: unknown): number | null {
  const id =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? parseInt(raw, 10)
        : NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

function collectSendcloudOrderNumbers(input: {
  cartId: string;
  shipmentId: string;
  meta: Record<string, unknown>;
  extraOrderNumbers?: string[];
}): string[] {
  const numbers = new Set<string>();
  const fromMeta = String(input.meta.sendcloud_order_number ?? "").trim();
  if (fromMeta) numbers.add(fromMeta);

  for (const extra of input.extraOrderNumbers ?? []) {
    const on = extra.trim();
    if (on) numbers.add(on);
  }

  const maxGen = Math.max(1, Math.min(10, Math.trunc(Number(input.meta.sendcloud_label_generation ?? 1))));
  for (let gen = 1; gen <= maxGen + 2; gen++) {
    numbers.add(
      buildSendcloudOrderNumber({
        cartId: input.cartId,
        shipmentId: input.shipmentId,
        generation: gen,
      }),
    );
  }

  return [...numbers];
}

/** Suivi aller Chronopost à ne pas annuler quand commande Sendcloud partagée. */
function isProtectedOutboundTracking(trackingNumber: string, outboundTracking: string | null): boolean {
  const tn = trackingNumber.trim().toUpperCase();
  if (!tn) return false;
  const out = (outboundTracking ?? "").trim().toUpperCase();
  if (out && tn === out) return true;
  return /^XG[A-Z0-9]/i.test(tn);
}

function shouldCancelParcelForCartReturn(
  parcel: SendcloudShipmentParcel,
  returnTrackings: Set<string>,
  outboundTracking: string | null,
): boolean {
  const tn = String(parcel.tracking_number ?? "").trim();
  if (isProtectedOutboundTracking(tn, outboundTracking)) return false;
  if (tn && returnTrackings.has(tn)) return true;
  if (/^\d{8}$/.test(tn)) return true;
  if (/^XT/i.test(tn)) return true;
  return false;
}

async function cancelSendcloudParcelById(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  parcelId: number,
  notices: string[],
  context: string,
): Promise<void> {
  if (parcelId <= 0) return;

  const snap = await fetchSendcloudParcel(env, parcelId);
  if (snap?.isCancelled) {
    notices.push(`Colis retour Sendcloud ${parcelId} déjà annulé (${context}).`);
    return;
  }

  const cancelled = await cancelSendcloudOutboundParcel(env, parcelId);
  if (cancelled.ok) {
    notices.push(`Colis retour Sendcloud ${parcelId} annulé (${context}).`);
  } else {
    notices.push(`Échec annulation colis retour ${parcelId} (${context}) : ${cancelled.error}`);
  }
}

async function cancelSendcloudParcelsAndShipmentsForOrderNumber(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  orderNumber: string,
  seedParcelIds: Iterable<number>,
  returnTrackings: Set<string>,
  outboundTracking: string | null,
  notices: string[],
): Promise<void> {
  const on = orderNumber.trim();
  if (!on) return;

  const parcelIds = new Set<number>();
  for (const id of seedParcelIds) {
    if (id > 0) parcelIds.add(id);
  }

  const listedParcels = await findSendcloudParcelsByOrderNumberV3(env, on, { includeCancelled: false });
  for (const parcel of listedParcels) {
    if (parcel.id > 0 && shouldCancelParcelForCartReturn(parcel, returnTrackings, outboundTracking)) {
      parcelIds.add(parcel.id);
    }
  }

  const hasReturnParcelOnOrder = listedParcels.some((p) =>
    shouldCancelParcelForCartReturn(p, returnTrackings, outboundTracking),
  );

  if (hasReturnParcelOnOrder) {
    for (const shipmentId of await findSendcloudShipmentIdsByOrderNumber(env, on)) {
      const returnOnlyShipment = listedParcels.every((p) =>
        shouldCancelParcelForCartReturn(p, returnTrackings, outboundTracking),
      );
      if (!returnOnlyShipment) continue;
      const cancelled = await cancelSendcloudShipment(env, shipmentId);
      if (cancelled.ok) {
        notices.push(`Expédition Sendcloud retour ${shipmentId} annulée (${on}).`);
      } else {
        notices.push(`Échec annulation expédition retour ${shipmentId} : ${cancelled.error}`);
      }
    }
  }

  for (const parcelId of parcelIds) {
    await cancelSendcloudParcelById(env, parcelId, notices, on);
  }
}

/** Annule côté Sendcloud la commande / tous les colis retour liés au panier (best-effort). */
export async function cancelCartReturnSendcloudOrder(
  admin: SupabaseClient,
  cartId: string,
): Promise<CancelCartReturnSendcloudOrderResult> {
  const notices: string[] = [];
  const env = getSendcloudEnv();
  if (!env) {
    return { ok: true, skipped: true, reason: "sendcloud_not_configured", notices };
  }

  const trimmedCartId = cartId.trim();

  const [{ data: ship }, { data: outShip }] = await Promise.all([
    admin
      .from("shipments")
      .select("id, tracking_number")
      .eq("cart_id", trimmedCartId)
      .eq("context", "cart_return")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("shipments")
      .select("tracking_number, shipment_destinations(metadata)")
      .eq("cart_id", trimmedCartId)
      .eq("context", "cart_outbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!ship?.id) {
    return { ok: true, skipped: true, reason: "no_return_shipment", notices };
  }

  const shipmentId = String(ship.id);
  const returnTrackings = new Set<string>();
  const returnTn = String((ship as { tracking_number?: string }).tracking_number ?? "").trim();
  if (returnTn) returnTrackings.add(returnTn);

  const outDestEmb = (outShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const outDestRow = Array.isArray(outDestEmb) ? outDestEmb[0] : outDestEmb;
  const outboundMeta =
    outDestRow &&
    typeof outDestRow === "object" &&
    "metadata" in outDestRow &&
    outDestRow.metadata &&
    typeof outDestRow.metadata === "object"
      ? (outDestRow.metadata as Record<string, unknown>)
      : {};
  const outboundTracking = String((outShip as { tracking_number?: string } | null)?.tracking_number ?? "").trim() || null;
  const outboundOrderNumber = String(outboundMeta.sendcloud_order_number ?? "").trim();
  const outboundPanelOrderId = String(outboundMeta.sendcloud_panel_order_id ?? "").trim();

  const { data: dest } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", shipmentId)
    .limit(1)
    .maybeSingle();

  const meta =
    dest?.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};

  const seedParcelIds = new Set<number>();
  const metaParcelId = parseParcelId(meta.sendcloud_parcel_id);
  if (metaParcelId) seedParcelIds.add(metaParcelId);

  const { data: labelRows } = await admin
    .from("shipment_labels")
    .select("label_url")
    .eq("shipment_id", shipmentId);

  for (const row of labelRows ?? []) {
    const url = typeof row.label_url === "string" ? row.label_url : "";
    const fromUrl = parseSendcloudParcelIdFromLabelUrl(url);
    if (fromUrl) seedParcelIds.add(fromUrl);
  }

  for (const tn of returnTrackings) {
    const fromTracking = await resolveSendcloudParcelIdFromTracking(env, tn);
    if (fromTracking) seedParcelIds.add(fromTracking);
  }

  const orderNumbers = collectSendcloudOrderNumbers({
    cartId: trimmedCartId,
    shipmentId,
    meta,
    extraOrderNumbers: outboundOrderNumber ? [outboundOrderNumber] : [],
  });

  for (const orderNumber of orderNumbers) {
    await cancelSendcloudParcelsAndShipmentsForOrderNumber(
      env,
      orderNumber,
      seedParcelIds,
      returnTrackings,
      outboundTracking,
      notices,
    );
  }

  const integrationId = await resolveSendcloudIntegrationId(env);
  const panelOrderId = String(meta.sendcloud_panel_order_id ?? "").trim();
  const primaryOrderNumber =
    String(meta.sendcloud_order_number ?? "").trim() ||
    buildSendcloudOrderNumber({ cartId: trimmedCartId, shipmentId, generation: 1 });

  const orderIdsToDelete = new Set<string>();
  if (panelOrderId && panelOrderId !== outboundPanelOrderId) {
    orderIdsToDelete.add(panelOrderId);
  }

  if (integrationId) {
    for (const orderNumber of orderNumbers) {
      if (orderNumber === outboundOrderNumber) continue;
      const found = await findSendcloudOrderByNumber(env, orderNumber, integrationId);
      const id = String(found?.id ?? "").trim();
      if (id && id !== outboundPanelOrderId) orderIdsToDelete.add(id);
    }
  }

  for (const orderIdToDelete of orderIdsToDelete) {
    const deleted = await deleteSendcloudOrder(env, orderIdToDelete);
    if (deleted.ok) {
      notices.push(`Commande retour Sendcloud ${orderIdToDelete} supprimée.`);
    } else {
      notices.push(`Échec suppression commande retour Sendcloud ${orderIdToDelete} : ${deleted.error}`);
    }
  }

  const cancelledAt = new Date().toISOString();
  const nextMeta = { ...meta };
  delete nextMeta.sendcloud_panel_order_id;
  delete nextMeta.sendcloud_order_provisioned_at;
  delete nextMeta.sendcloud_parcel_id;
  nextMeta.sendcloud_order_cancelled_at = cancelledAt;
  if (!nextMeta.sendcloud_order_number && primaryOrderNumber) {
    nextMeta.sendcloud_order_number = primaryOrderNumber;
  }

  const destId = (dest as { id?: string } | null)?.id;
  if (destId) {
    await admin.from("shipment_destinations").update({ metadata: nextMeta }).eq("id", destId);
  }

  return { ok: true, notices };
}
