import type { SupabaseClient } from "@supabase/supabase-js";

import { getSendcloudEnv } from "@/lib/sendcloud/config";
import {
  cancelSendcloudOutboundParcel,
  deleteSendcloudOrder,
  findSendcloudOrderByNumber,
} from "@/lib/sendcloud/orders-api";
import { markCartSendcloudOutboundCancelled } from "@/lib/cart/persist-cart-sendcloud-outbound-ref";
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
} from "@/lib/sendcloud/shipments";

export type CancelCartOutboundSendcloudOrderResult = {
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
  cartOrderNumber?: string | null;
}): string[] {
  const numbers = new Set<string>();
  const fromMeta = String(input.meta.sendcloud_order_number ?? "").trim();
  if (fromMeta) numbers.add(fromMeta);
  const fromCart = String(input.cartOrderNumber ?? "").trim();
  if (fromCart) numbers.add(fromCart);

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

async function cancelSendcloudParcelsAndShipmentsForOrderNumber(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  orderNumber: string,
  seedParcelIds: Iterable<number>,
  notices: string[],
): Promise<void> {
  const on = orderNumber.trim();
  if (!on) return;

  const parcelIds = new Set<number>();
  for (const id of seedParcelIds) {
    if (id > 0) parcelIds.add(id);
  }

  for (const shipmentId of await findSendcloudShipmentIdsByOrderNumber(env, on)) {
    const cancelled = await cancelSendcloudShipment(env, shipmentId);
    if (cancelled.ok) {
      notices.push(`Expédition Sendcloud ${shipmentId} annulée (${on}).`);
    } else {
      notices.push(`Échec annulation expédition ${shipmentId} : ${cancelled.error}`);
    }
  }

  for (const parcel of await findSendcloudParcelsByOrderNumberV3(env, on)) {
    if (parcel.id > 0) parcelIds.add(parcel.id);
  }

  for (const parcelId of parcelIds) {
    const snap = await fetchSendcloudParcel(env, parcelId);
    if (snap?.isCancelled) {
      notices.push(`Colis Sendcloud ${parcelId} déjà annulé.`);
      continue;
    }

    const listed = await findSendcloudParcelsByOrderNumberV3(env, on);
    const listedParcel = listed.find((p) => p.id === parcelId);
    if (listedParcel && isSendcloudParcelCancelled(listedParcel)) {
      notices.push(`Colis Sendcloud ${parcelId} déjà annulé (v3).`);
      continue;
    }

    const cancelled = await cancelSendcloudOutboundParcel(env, parcelId);
    if (cancelled.ok) {
      notices.push(`Colis Sendcloud ${parcelId} annulé (${on}).`);
    } else {
      notices.push(`Échec annulation colis ${parcelId} : ${cancelled.error}`);
    }
  }
}

/**
 * Annule côté Sendcloud la commande / tous les colis aller liés au panier (best-effort, ne bloque pas l’annulation BO).
 */
export async function cancelCartOutboundSendcloudOrder(
  admin: SupabaseClient,
  cartId: string,
): Promise<CancelCartOutboundSendcloudOrderResult> {
  const notices: string[] = [];
  const env = getSendcloudEnv();
  if (!env) {
    return { ok: true, skipped: true, reason: "sendcloud_not_configured", notices };
  }

  const trimmedCartId = cartId.trim();

  const { data: cartRow } = await admin
    .from("carts")
    .select("sendcloud_outbound_order_number")
    .eq("id", trimmedCartId)
    .is("deleted_at", null)
    .maybeSingle();

  const { data: ship } = await admin
    .from("shipments")
    .select("id")
    .eq("cart_id", trimmedCartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ship?.id) {
    return { ok: true, skipped: true, reason: "no_shipment", notices };
  }

  const shipmentId = String(ship.id);

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

  const orderNumbers = collectSendcloudOrderNumbers({
    cartId: trimmedCartId,
    shipmentId,
    meta,
    cartOrderNumber:
      typeof cartRow?.sendcloud_outbound_order_number === "string"
        ? cartRow.sendcloud_outbound_order_number
        : null,
  });

  for (const orderNumber of orderNumbers) {
    await cancelSendcloudParcelsAndShipmentsForOrderNumber(env, orderNumber, seedParcelIds, notices);
  }

  const integrationId = await resolveSendcloudIntegrationId(env);
  const panelOrderId = String(meta.sendcloud_panel_order_id ?? "").trim();
  const primaryOrderNumber =
    String(meta.sendcloud_order_number ?? "").trim() ||
    String(cartRow?.sendcloud_outbound_order_number ?? "").trim() ||
    buildSendcloudOrderNumber({ cartId: trimmedCartId, shipmentId, generation: 1 });

  const orderIdsToDelete = new Set<string>();
  if (panelOrderId) orderIdsToDelete.add(panelOrderId);

  if (integrationId) {
    for (const orderNumber of orderNumbers) {
      const found = await findSendcloudOrderByNumber(env, orderNumber, integrationId);
      const id = String(found?.id ?? "").trim();
      if (id) orderIdsToDelete.add(id);
    }
  }

  for (const orderIdToDelete of orderIdsToDelete) {
    const deleted = await deleteSendcloudOrder(env, orderIdToDelete);
    if (deleted.ok) {
      notices.push(`Commande Sendcloud ${orderIdToDelete} supprimée.`);
    } else {
      notices.push(`Échec suppression commande Sendcloud ${orderIdToDelete} : ${deleted.error}`);
    }
  }

  if (orderIdsToDelete.size === 0 && meta.sendcloud_order_provisioned_at) {
    notices.push("Commande Sendcloud introuvable (déjà supprimée ?).");
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

  await markCartSendcloudOutboundCancelled(admin, trimmedCartId, {
    cancelledAt,
    orderNumber: primaryOrderNumber || undefined,
  });

  return { ok: true, notices };
}
