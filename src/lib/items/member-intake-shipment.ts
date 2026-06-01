import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clearItemIntakeShippingLabelMetadata,
  patchItemIntakeSendcloudMetadata,
} from "@/lib/items/item-intake-sendcloud-patch";
import { getSendcloudEnv, type SendcloudEnv } from "@/lib/sendcloud/config";
import {
  buildCarrierTrackingUrlFromNumber,
  isSendcloudLabelOrInternalUrl,
} from "@/lib/shipping/intake-carrier-tracking";
import { buildSendcloudV3ParcelLabelUrl } from "@/lib/sendcloud/label-url";
import { resolveMemberIntakeItemIds } from "@/lib/items/resolve-member-intake-item-ids";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";
import {
  isIntakeMemberReturnTrackingNumber,
  parseIntakeShippingLabelFromMetadata,
  parseScMergeItemIdsFromIntakeMetadata,
  parseSendcloudFromIntakeMetadata,
  readMemberIntakeShipmentIdFromMetadata,
  readShippingPreferSolo,
  SC_SHIPPING_PREFER_SOLO,
} from "@/lib/items/intake-shipping-metadata";
import { cancelSendcloudOutboundParcel } from "@/lib/sendcloud/orders-api";
import { fetchSendcloudParcel } from "@/lib/sendcloud/parcel-sync";
import { cancelSendcloudShipment } from "@/lib/sendcloud/return-portal-shipment";
import {
  cancelSendcloudReturnV3,
  cancelSendcloudReturnsForOrderNumber,
  cancelSendcloudReturnsForTrackingNumbers,
  findSendcloudReturnsByOrderNumber,
} from "@/lib/sendcloud/returns-api";
import {
  findSendcloudParcelsByOrderNumberV3,
  findSendcloudShipmentIdsByOrderNumber,
} from "@/lib/sendcloud/shipments";
import type { SendcloudOutboundRecipient } from "@/lib/sendcloud/shipments";

/** UUID `public.shipments` (context `member_intake`) — conservé entre réinitialisations portail. */
export const SC_MEMBER_INTAKE_SHIPMENT_ID = "sc_member_intake_shipment_id";

export { readMemberIntakeShipmentIdFromMetadata } from "@/lib/items/intake-shipping-metadata";

const DEST_INTAKE_ITEM_IDS = "sc_intake_item_ids";
const DEST_OWNER_USER_ID = "sc_intake_owner_user_id";

/** URL de base du portail Sendcloud (sans query de préremplissage), conservée entre réinitialisations. */
export const SC_RETURN_PORTAL_BASE_URL = "sc_return_portal_base_url";

/** Colis retour Sendcloud annulés lors d’un « Nouveau bordereau » — exclus du sync automatique. */
export const SC_EXCLUDED_RETURN_PARCEL_IDS = "sc_excluded_return_parcel_ids";

/** Numéros XT annulés lors d’un « Nouveau bordereau » — exclus du sync automatique. */
export const SC_EXCLUDED_RETURN_TRACKING_NUMBERS = "sc_excluded_return_tracking_numbers";

/** Fusion intake membre : max 2 pièces par colis (slots DB item_intake_1_id … item_intake_2_id). */
export const MEMBER_INTAKE_SHIPMENT_MAX_ITEMS = 2;

export const MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS = [
  "item_intake_1_id",
  "item_intake_2_id",
] as const;

export type MemberIntakeShipmentItemIntakeColumn =
  (typeof MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS)[number];

export function buildMemberIntakeShipmentItemIntakePatch(
  itemIds: string[],
): Record<MemberIntakeShipmentItemIntakeColumn, string | null> {
  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))]
    .sort()
    .slice(0, MEMBER_INTAKE_SHIPMENT_MAX_ITEMS);
  return buildMemberIntakeShipmentItemIntakePatchOrdered(sorted);
}

/** Slots DB dans l’ordre fourni (sans re-tri alphabétique). */
export function buildMemberIntakeShipmentItemIntakePatchOrdered(
  orderedItemIds: string[],
): Record<MemberIntakeShipmentItemIntakeColumn, string | null> {
  const unique: string[] = [];
  for (const raw of orderedItemIds) {
    const id = raw.trim();
    if (!id || unique.includes(id)) continue;
    unique.push(id);
    if (unique.length >= MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) break;
  }
  return {
    item_intake_1_id: unique[0] ?? null,
    item_intake_2_id: unique[1] ?? null,
  };
}

/**
 * Regroupement sur colis existant : conserve l’ordre des slots déjà occupés,
 * ajoute les nouvelles pièces triées alphabétiquement en fin de liste.
 */
export function buildMemberIntakeShipmentItemIntakePatchForMerge(
  existingSlotIds: string[],
  targetItemIds: string[],
): Record<MemberIntakeShipmentItemIntakeColumn, string | null> {
  const targetSet = new Set(
    [...new Set(targetItemIds.map((x) => x.trim()).filter(Boolean))].slice(
      0,
      MEMBER_INTAKE_SHIPMENT_MAX_ITEMS,
    ),
  );
  const preserved: string[] = [];
  for (const raw of existingSlotIds) {
    const id = raw.trim();
    if (!id || !targetSet.has(id) || preserved.includes(id)) continue;
    preserved.push(id);
  }
  const appended = [...targetSet]
    .filter((id) => !preserved.includes(id))
    .sort((a, b) => a.localeCompare(b));
  return buildMemberIntakeShipmentItemIntakePatchOrdered([...preserved, ...appended]);
}

export function readMemberIntakeIdsFromShipmentRow(row: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const col of MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS) {
    const v = typeof row[col] === "string" ? row[col].trim() : "";
    if (v) ids.push(v);
  }
  return ids;
}

function memberIntakeShipmentItemIntakeOrFilter(itemId: string): string {
  return MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS.map((col) => `${col}.eq.${itemId}`).join(",");
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function readScMemberIntakeShipmentId(metadata: unknown): string | null {
  if (!isPlainRecord(metadata)) return null;
  const sc = metadata.sendcloud;
  if (!isPlainRecord(sc)) return null;
  const id = typeof sc[SC_MEMBER_INTAKE_SHIPMENT_ID] === "string" ? sc[SC_MEMBER_INTAKE_SHIPMENT_ID].trim() : "";
  return id || null;
}

function primaryMemberIntakeItemId(itemIds: string[]): string | null {
  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  return sorted[0] ?? null;
}

async function syncMemberIntakeShipmentItemIntakeLink(
  service: SupabaseClient,
  shipmentId: string,
  itemIds: string[],
  options?: { mergeWithExistingSlots?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sid = shipmentId.trim();
  let patch: Record<MemberIntakeShipmentItemIntakeColumn, string | null>;

  if (options?.mergeWithExistingSlots) {
    const slotCols = MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS.join(", ");
    const { data: row, error: readErr } = await service
      .from("shipments")
      .select(slotCols)
      .eq("id", sid)
      .eq("context", "member_intake")
      .is("deleted_at", null)
      .maybeSingle();
    if (readErr) return { ok: false, error: readErr.message };
    const existing = row ? readMemberIntakeIdsFromShipmentRow(row as Record<string, unknown>) : [];
    patch = buildMemberIntakeShipmentItemIntakePatchForMerge(existing, itemIds);
  } else {
    patch = buildMemberIntakeShipmentItemIntakePatch(itemIds);
  }

  if (!patch.item_intake_1_id) {
    return { ok: false, error: "Aucune pièce." };
  }

  const released = await archiveConflictingActiveMemberIntakeShipments(service, itemIds, sid);
  if (!released.ok) return released;

  const { error } = await service
    .from("shipments")
    .update({ ...patch, cart_id: null })
    .eq("id", sid)
    .eq("context", "member_intake")
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function findMemberIntakeShipmentByItemIntakeId(
  service: SupabaseClient,
  itemIntakeId: string,
): Promise<string | null> {
  const itemId = itemIntakeId.trim();
  if (!itemId) return null;
  const { data } = await service
    .from("shipments")
    .select("id")
    .eq("context", "member_intake")
    .or(memberIntakeShipmentItemIntakeOrFilter(itemId))
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

/** Shipment `member_intake` actif : metadata si encore valide, sinon recherche par slots item_intake. */
export async function resolveActiveMemberIntakeShipmentIdForItems(
  service: SupabaseClient,
  itemIds: string[],
  metadataShipmentId?: string | null,
): Promise<string | null> {
  const preferred = metadataShipmentId?.trim();
  if (preferred) {
    const loaded = await loadMemberIntakeShipment(service, preferred);
    if (loaded) return loaded.id;
  }

  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  for (const itemId of sorted) {
    const sid = await findMemberIntakeShipmentByItemIntakeId(service, itemId);
    if (sid) return sid;
  }
  return null;
}

export async function readMemberIntakeDestinationMetadata(
  service: SupabaseClient,
  shipmentId: string,
): Promise<Record<string, unknown>> {
  const { data: dest } = await service
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", shipmentId.trim())
    .limit(1)
    .maybeSingle();

  if (!dest?.metadata || typeof dest.metadata !== "object" || Array.isArray(dest.metadata)) {
    return {};
  }
  return { ...(dest.metadata as Record<string, unknown>) };
}

function readExcludedReturnParcelIds(metadata: Record<string, unknown>): number[] {
  const raw = metadata[SC_EXCLUDED_RETURN_PARCEL_IDS];
  if (!Array.isArray(raw)) return [];
  const ids = new Set<number>();
  for (const entry of raw) {
    const n =
      typeof entry === "number"
        ? entry
        : typeof entry === "string"
          ? parseInt(entry, 10)
          : NaN;
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return [...ids];
}

function readExcludedReturnTrackingNumbers(metadata: Record<string, unknown>): string[] {
  const raw = metadata[SC_EXCLUDED_RETURN_TRACKING_NUMBERS];
  if (!Array.isArray(raw)) return [];
  const keys = new Set<string>();
  for (const entry of raw) {
    const tn = String(entry ?? "").trim().toUpperCase();
    if (tn) keys.add(tn);
  }
  return [...keys];
}

export async function saveMemberIntakePortalBaseUrl(
  service: SupabaseClient,
  shipmentId: string,
  baseUrl: string,
): Promise<void> {
  const trimmed = baseUrl.trim();
  if (!trimmed.startsWith("http")) return;

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
  await service
    .from("shipment_destinations")
    .update({ metadata: { ...prev, [SC_RETURN_PORTAL_BASE_URL]: trimmed } })
    .eq("id", dest.id);
}

export type MemberIntakeSendcloudCancelInput = {
  orderNumbers: string[];
  panelShipmentIds: string[];
  trackingNumbers: string[];
  parcelIds: number[];
};

function pushTrackingNumber(set: Set<string>, value: string | null | undefined): void {
  const tn = String(value ?? "").trim();
  if (!tn) return;
  set.add(tn);
}

function pushOrderNumber(set: Set<string>, value: string | null | undefined): void {
  const on = String(value ?? "").trim();
  if (!on) return;
  set.add(on);
}

function readSendcloudStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Agrège commandes / expéditions / suivis Sendcloud liés à un groupe de pièces intake. */
export function gatherMemberIntakeSendcloudCancelInput(
  itemMetadataRows: unknown[],
  options?: {
    defaultOrderNumber?: string | null;
    destinationMetadata?: Record<string, unknown> | null;
    shipmentTrackingNumber?: string | null;
  },
): MemberIntakeSendcloudCancelInput {
  const orderNumbers = new Set<string>();
  const panelShipmentIds = new Set<string>();
  const trackingNumbers = new Set<string>();
  const parcelIds = new Set<number>();

  pushOrderNumber(orderNumbers, options?.defaultOrderNumber ?? null);
  pushTrackingNumber(trackingNumbers, options?.shipmentTrackingNumber ?? null);

  const dest = options?.destinationMetadata ?? null;
  if (dest) {
    pushOrderNumber(orderNumbers, readSendcloudStr(dest, "sendcloud_order_number"));
    const panelId = readSendcloudStr(dest, "sendcloud_panel_shipment_id");
    if (panelId) panelShipmentIds.add(panelId);
    for (const key of ["sendcloud_parcel_id", "sc_outgoing_parcel_id"] as const) {
      const raw = dest[key];
      const pid =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? parseInt(raw, 10)
            : NaN;
      if (Number.isFinite(pid) && pid > 0) parcelIds.add(pid);
    }
  }

  for (const metadata of itemMetadataRows) {
    if (!isPlainRecord(metadata)) continue;
    const sc = metadata.sendcloud;
    if (!isPlainRecord(sc)) continue;
    pushOrderNumber(orderNumbers, readSendcloudStr(sc, "sc_order_number"));
    pushOrderNumber(orderNumbers, readSendcloudStr(sc, "reference_expedition"));
    const panel = readSendcloudStr(sc, "sc_dummy_shipment_id");
    if (panel) panelShipmentIds.add(panel);
    const label = parseIntakeShippingLabelFromMetadata(metadata);
    pushTrackingNumber(trackingNumbers, label?.numero_suivi);
    const outgoing = readSendcloudStr(sc, "sc_outgoing_parcel_id");
    if (outgoing) {
      const pid = parseInt(outgoing, 10);
      if (Number.isFinite(pid) && pid > 0) parcelIds.add(pid);
    }
  }

  return {
    orderNumbers: [...orderNumbers],
    panelShipmentIds: [...panelShipmentIds],
    trackingNumbers: [...trackingNumbers],
    parcelIds: [...parcelIds],
  };
}

export async function loadMemberIntakeSendcloudCancelInput(
  service: SupabaseClient,
  params: { itemIds: string[]; defaultOrderNumber: string },
): Promise<MemberIntakeSendcloudCancelInput> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  const { data: intakeRows } = await service
    .from("item_intake")
    .select("item_id, metadata")
    .in("item_id", sortedIds);

  const metas = (intakeRows ?? []).map((r) => r.metadata);
  let memberShipId: string | null = null;
  for (const meta of metas) {
    const sid = readMemberIntakeShipmentIdFromMetadata(meta);
    if (sid) {
      memberShipId = sid;
      break;
    }
  }

  let shipmentTracking: string | null = null;
  let destMeta: Record<string, unknown> | null = null;
  if (memberShipId) {
    const { data: ship } = await service
      .from("shipments")
      .select("tracking_number")
      .eq("id", memberShipId)
      .maybeSingle();
    shipmentTracking =
      typeof ship?.tracking_number === "string" ? ship.tracking_number.trim() : null;
    destMeta = await readMemberIntakeDestinationMetadata(service, memberShipId);
  }

  const input = gatherMemberIntakeSendcloudCancelInput(metas, {
    defaultOrderNumber: params.defaultOrderNumber,
    destinationMetadata: destMeta,
    shipmentTrackingNumber: shipmentTracking,
  });

  if (
    shipmentTracking &&
    isIntakeMemberReturnTrackingNumber(shipmentTracking) &&
    !input.trackingNumbers.includes(shipmentTracking)
  ) {
    input.trackingNumbers.push(shipmentTracking);
  }

  return input;
}

/** Données Sendcloud à annuler pour un shipment `member_intake` (slots, destination, metadata intake). */
export async function loadMemberIntakeSendcloudCancelInputForShipment(
  service: SupabaseClient,
  shipmentId: string,
): Promise<MemberIntakeSendcloudCancelInput> {
  const sid = shipmentId.trim();
  if (!sid) {
    return { orderNumbers: [], panelShipmentIds: [], trackingNumbers: [], parcelIds: [] };
  }

  const { data: ship } = await service
    .from("shipments")
    .select(`tracking_number, ${MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS.join(", ")}`)
    .eq("id", sid)
    .maybeSingle();

  const destMeta = await readMemberIntakeDestinationMetadata(service, sid);
  const defaultOrder = String(destMeta.sendcloud_order_number ?? "").trim();

  const itemIdSet = new Set(await resolveMemberIntakeItemIds(service, sid));
  if (ship) {
    for (const id of readMemberIntakeIdsFromShipmentRow(ship as Record<string, unknown>)) {
      itemIdSet.add(id);
    }
  }

  const itemIds = [...itemIdSet];
  let merged: MemberIntakeSendcloudCancelInput;

  if (itemIds.length > 0) {
    merged = await loadMemberIntakeSendcloudCancelInput(service, {
      itemIds,
      defaultOrderNumber: defaultOrder || buildStableMemberIntakeOrderNumber(itemIds),
    });
  } else {
    merged = gatherMemberIntakeSendcloudCancelInput([], {
      defaultOrderNumber: defaultOrder,
      destinationMetadata: destMeta,
      shipmentTrackingNumber:
        typeof ship?.tracking_number === "string" ? ship.tracking_number.trim() : null,
    });
  }

  const partial = gatherMemberIntakeSendcloudCancelInput([], {
    defaultOrderNumber: defaultOrder,
    destinationMetadata: destMeta,
    shipmentTrackingNumber:
      typeof ship?.tracking_number === "string" ? ship.tracking_number.trim() : null,
  });
  merged = mergeMemberIntakeCancelInputs(merged, partial);

  const panelFromDest = destMeta.sendcloud_panel_shipment_id;
  if (typeof panelFromDest === "string" && panelFromDest.trim()) {
    merged.panelShipmentIds = [
      ...new Set([...merged.panelShipmentIds, panelFromDest.trim()]),
    ];
  }

  return merged;
}

export async function cancelMemberIntakeSendcloudForArchivedShipment(
  service: SupabaseClient,
  shipmentId: string,
  options?: { sendcloudEnv?: SendcloudEnv | null },
): Promise<{ ok: true; cancelled: boolean } | { ok: false; error: string }> {
  const sid = shipmentId.trim();
  if (!sid) return { ok: true, cancelled: false };

  const env = options?.sendcloudEnv ?? getSendcloudEnv();
  if (!env) return { ok: true, cancelled: false };

  const cancelInput = await loadMemberIntakeSendcloudCancelInputForShipment(service, sid);
  const hasArtifacts =
    cancelInput.orderNumbers.length > 0 ||
    cancelInput.panelShipmentIds.length > 0 ||
    cancelInput.trackingNumbers.length > 0 ||
    cancelInput.parcelIds.length > 0;
  if (!hasArtifacts) return { ok: true, cancelled: false };

  const cancelled = await cancelMemberIntakeSendcloudArtifacts(env, cancelInput);
  if (!cancelled.ok) return { ok: false, error: cancelled.error };
  return { ok: true, cancelled: true };
}

/** Annule expéditions aller, colis et retours Sendcloud liés à l’intake membre. */
export async function cancelMemberIntakeSendcloudArtifacts(
  env: SendcloudEnv,
  input: MemberIntakeSendcloudCancelInput,
): Promise<{ ok: true; cancelledReturnIds: number[] } | { ok: false; error: string }> {
  const panelIds = new Set(input.panelShipmentIds.map((x) => x.trim()).filter(Boolean));
  const cancelledReturnIds = new Set<number>();

  for (const on of input.orderNumbers) {
    const listed = await findSendcloudShipmentIdsByOrderNumber(env, on);
    for (const id of listed) panelIds.add(id);

    const parcels = await findSendcloudParcelsByOrderNumberV3(env, on);
    for (const parcel of parcels) {
      if (typeof parcel.id === "number" && parcel.id > 0) {
        await cancelSendcloudOutboundParcel(env, parcel.id).catch(() => undefined);
      }
    }

    const byOrder = await cancelSendcloudReturnsForOrderNumber(env, on);
    if (!byOrder.ok) {
      return { ok: false, error: byOrder.error };
    }
    for (const id of byOrder.cancelledIds) cancelledReturnIds.add(id);
  }

  for (const id of panelIds) {
    await cancelSendcloudShipment(env, id).catch(() => undefined);
  }

  for (const pid of input.parcelIds) {
    await cancelSendcloudOutboundParcel(env, pid).catch(() => undefined);
  }

  const trackingKeys = [...new Set(input.trackingNumbers.map((tn) => tn.trim()).filter(Boolean))];
  if (trackingKeys.length > 0) {
    const byTn = await cancelSendcloudReturnsForTrackingNumbers(env, trackingKeys);
    if (!byTn.ok) {
      return { ok: false, error: byTn.error };
    }
    for (const id of byTn.cancelledIds) cancelledReturnIds.add(id);
  }

  return { ok: true, cancelledReturnIds: [...cancelledReturnIds] };
}

/** @deprecated Préférer cancelMemberIntakeSendcloudArtifacts */
export async function cancelMemberIntakeSendcloudForOrder(
  env: SendcloudEnv,
  orderNumber: string,
  knownPanelShipmentIds: string[] = [],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await cancelMemberIntakeSendcloudArtifacts(env, {
    orderNumbers: orderNumber.trim() ? [orderNumber.trim()] : [],
    panelShipmentIds: knownPanelShipmentIds,
    trackingNumbers: [],
    parcelIds: [],
  });
  if (!res.ok) return res;
  return { ok: true };
}

/** Soft-delete du shipment DB `member_intake` (mutualisation ou abandon portail dédié). */
export async function archiveMemberIntakeShipment(
  service: SupabaseClient,
  shipmentId: string,
  options?: { skipSendcloudCancel?: boolean; sendcloudEnv?: SendcloudEnv | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sid = shipmentId.trim();
  if (!sid) return { ok: false, error: "ID expédition manquant." };

  if (!options?.skipSendcloudCancel) {
    const cancelled = await cancelMemberIntakeSendcloudForArchivedShipment(service, sid, {
      sendcloudEnv: options?.sendcloudEnv,
    });
    if (!cancelled.ok) {
      console.warn("[archiveMemberIntakeShipment] sendcloud cancel", sid, cancelled.error);
    }
  }

  const nowIso = new Date().toISOString();
  const patch = {
    deleted_at: nowIso,
    item_intake_1_id: null,
    item_intake_2_id: null,
    updated_at: nowIso,
  };

  const { data, error } = await service
    .from("shipments")
    .update(patch)
    .eq("id", sid)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (data?.id) return { ok: true };

  const fallback = await service
    .from("shipments")
    .update(patch)
    .eq("id", sid)
    .is("deleted_at", null)
    .select("id, context")
    .maybeSingle();

  if (fallback.error) return { ok: false, error: fallback.error.message };
  if (!fallback.data?.id) {
    return { ok: false, error: "Shipment introuvable ou déjà archivé." };
  }

  return { ok: true };
}

/** Tous les `member_intake` actifs liés à un lot (metadata + destinations). */
export async function collectMemberIntakeShipmentIdsForGroup(
  service: SupabaseClient,
  itemIds: string[],
): Promise<string[]> {
  const sortedIds = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length === 0) return [];

  const seen = new Set<string>();
  const itemKey = sortedIds.join(",");

  const { data: intakeRows } = await service
    .from("item_intake")
    .select("item_id, metadata")
    .in("item_id", sortedIds);

  for (const row of intakeRows ?? []) {
    const meta = row.metadata;
    const memberSid = readMemberIntakeShipmentIdFromMetadata(meta);
    if (memberSid) seen.add(memberSid);
    const dummySid = readSendcloudField(meta, "sc_dummy_shipment_id");
    if (dummySid) seen.add(dummySid);
  }

  const { data: exactDest } = await service
    .from("shipment_destinations")
    .select("shipment_id")
    .eq("metadata->>sc_intake_item_ids", itemKey);
  for (const row of exactDest ?? []) {
    const sid = String((row as { shipment_id?: string }).shipment_id ?? "").trim();
    if (sid) seen.add(sid);
  }

  for (const itemId of sortedIds) {
    const { data: destRows } = await service
      .from("shipment_destinations")
      .select("shipment_id, metadata")
      .ilike("metadata->>sc_intake_item_ids", `%${itemId}%`);
    for (const row of destRows ?? []) {
      const destMeta =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;
      const csv = destMeta?.[DEST_INTAKE_ITEM_IDS];
      if (typeof csv !== "string" || !csv.trim()) continue;
      const idsInDest = csv.split(",").map((x) => x.trim()).filter(Boolean);
      if (!idsInDest.includes(itemId)) continue;
      const sid = String((row as { shipment_id?: string }).shipment_id ?? "").trim();
      if (sid) seen.add(sid);
    }
  }

  const orFilter = sortedIds.map((id) => memberIntakeShipmentItemIntakeOrFilter(id)).join(",");
  if (orFilter) {
    const { data: byFk } = await service
      .from("shipments")
      .select("id")
      .eq("context", "member_intake")
      .is("deleted_at", null)
      .or(orFilter);
    for (const row of byFk ?? []) {
      const sid = String((row as { id?: string }).id ?? "").trim();
      if (sid) seen.add(sid);
    }
  }

  const resolvedCandidates = [...seen];
  if (resolvedCandidates.length === 0) return [];

  const { data: ships } = await service
    .from("shipments")
    .select("id")
    .in("id", resolvedCandidates)
    .eq("context", "member_intake")
    .is("deleted_at", null);

  return (ships ?? []).map((s) => String(s.id));
}

export async function syncMemberIntakeShipmentTracking(
  service: SupabaseClient,
  shipmentId: string,
  params: { trackingNumber?: string | null; trackingUrl?: string | null },
): Promise<void> {
  const rawTn = params.trackingNumber?.trim();
  const tn =
    rawTn && isIntakeMemberReturnTrackingNumber(rawTn) ? rawTn : undefined;
  const rawUrl = params.trackingUrl?.trim();
  const memberUrl =
    rawUrl && !isSendcloudLabelOrInternalUrl(rawUrl)
      ? rawUrl
      : tn
        ? buildCarrierTrackingUrlFromNumber(tn)
        : undefined;
  if (!tn && !memberUrl) return;

  if (tn) {
    const destMeta = await readMemberIntakeDestinationMetadata(service, shipmentId);
    if (readExcludedReturnTrackingNumbers(destMeta).includes(tn.toUpperCase())) {
      return;
    }
  }

  await service
    .from("shipments")
    .update({
      ...(tn ? { tracking_number: tn } : {}),
      ...(memberUrl ? { member_tracking_url: memberUrl } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", shipmentId.trim())
    .eq("context", "member_intake");
}

async function loadMemberIntakeShipment(
  service: SupabaseClient,
  shipmentId: string,
): Promise<{ id: string; status: string } | null> {
  const { data } = await service
    .from("shipments")
    .select("id, status")
    .eq("id", shipmentId)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .maybeSingle();
  if (!data?.id) return null;
  return { id: String(data.id), status: String(data.status ?? "pending") };
}

async function findMemberIntakeShipmentByOrderNumber(
  service: SupabaseClient,
  orderNumber: string,
): Promise<string | null> {
  const on = orderNumber.trim();
  if (!on) return null;

  const { data: destRows } = await service
    .from("shipment_destinations")
    .select("shipment_id")
    .eq("metadata->>sendcloud_order_number", on)
    .limit(8);

  const shipmentIds = [
    ...new Set((destRows ?? []).map((r) => String((r as { shipment_id: string }).shipment_id))),
  ];
  if (shipmentIds.length === 0) return null;

  const { data: ships } = await service
    .from("shipments")
    .select("id")
    .in("id", shipmentIds)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  const id = ships?.[0]?.id;
  return id ? String(id) : null;
}

async function patchMemberIntakeDestinationIntakeItemIds(
  service: SupabaseClient,
  shipmentId: string,
  itemIds: string[],
): Promise<void> {
  const itemKey = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort().join(",");
  if (!itemKey) return;

  const { data: existing } = await service
    .from("shipments")
    .select("id")
    .eq("id", shipmentId.trim())
    .maybeSingle();
  if (!existing?.id) return;

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
  await service
    .from("shipment_destinations")
    .update({ metadata: { ...prev, [DEST_INTAKE_ITEM_IDS]: itemKey } })
    .eq("id", dest.id);
}

async function ensureMemberIntakeDestination(
  service: SupabaseClient,
  shipmentId: string,
  params: {
    orderNumber: string;
    itemIds: string[];
    ownerUserId: string;
    recipient: SendcloudOutboundRecipient;
    metaPatch?: Record<string, unknown>;
  },
): Promise<void> {
  const itemKey = [...params.itemIds].sort().join(",");
  const baseMeta: Record<string, unknown> = {
    sendcloud_order_number: params.orderNumber,
    [DEST_INTAKE_ITEM_IDS]: itemKey,
    [DEST_OWNER_USER_ID]: params.ownerUserId,
    ...params.metaPatch,
  };

  const { data: existing } = await service
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", shipmentId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const prev =
      existing.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, unknown>)
        : {};
    await service
      .from("shipment_destinations")
      .update({ metadata: { ...prev, ...baseMeta } })
      .eq("id", existing.id);
    return;
  }

  await service.from("shipment_destinations").insert({
    shipment_id: shipmentId,
    destination_type: "home",
    line1: "Segna — réception intake membre",
    metadata: baseMeta,
  });
}

/** Met à jour le colis retour membre (webhook Sendcloud) sur la destination intake. */
export async function patchMemberIntakeShipmentReturnParcel(
  service: SupabaseClient,
  shipmentId: string,
  parcelId: number,
  params?: { orderNumber?: string | null },
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
  const orderNumber = params?.orderNumber?.trim();
  if (
    (existing === pid || existing === String(pid)) &&
    (!orderNumber || prev.sendcloud_return_order_number === orderNumber)
  ) {
    return;
  }

  const nextMeta: Record<string, unknown> = {
    ...prev,
    sendcloud_parcel_id: pid,
    ...(orderNumber ? { sendcloud_return_order_number: orderNumber } : {}),
    sc_sendcloud_intake_return_parcel_at: new Date().toISOString(),
  };
  delete nextMeta[SC_EXCLUDED_RETURN_PARCEL_IDS];
  delete nextMeta[SC_EXCLUDED_RETURN_TRACKING_NUMBERS];

  await service.from("shipment_destinations").update({ metadata: nextMeta }).eq("id", dest.id);
}

/** Tous les shipments `member_intake` liés au lot (metadata, destinations, commandes Sendcloud). */
export async function resolveMemberIntakeShipmentIdsForPortalReset(
  service: SupabaseClient,
  params: { itemIds: string[]; orderNumbers?: string[] },
): Promise<string[]> {
  const ids = new Set(await collectMemberIntakeShipmentIdsForGroup(service, params.itemIds));
  for (const on of params.orderNumbers ?? []) {
    const trimmed = on.trim();
    if (!trimmed) continue;
    const sid = await findMemberIntakeShipmentByOrderNumber(service, trimmed);
    if (sid) ids.add(sid);
  }
  return [...ids];
}

async function collectIntakeReturnParcelIdsFromSendcloudOrders(
  env: SendcloudEnv,
  orderNumbers: string[],
  options?: { outgoingParcelId?: number | null; dummyParcelId?: number | null },
): Promise<number[]> {
  const ids = new Set<number>();
  const exclude = new Set<number>();
  if (options?.outgoingParcelId != null && options.outgoingParcelId > 0) {
    exclude.add(options.outgoingParcelId);
  }
  if (options?.dummyParcelId != null && options.dummyParcelId > 0) {
    exclude.add(options.dummyParcelId);
  }
  for (const on of orderNumbers) {
    const trimmed = on.trim();
    if (!trimmed) continue;
    const parcels = await findSendcloudParcelsByOrderNumberV3(env, trimmed);
    for (const parcel of parcels) {
      const pid = typeof parcel.id === "number" ? parcel.id : NaN;
      if (!Number.isFinite(pid) || pid <= 0 || exclude.has(pid)) continue;
      const tn = String(parcel.tracking_number ?? "").trim();
      if (isIntakeMemberReturnTrackingNumber(tn)) ids.add(pid);
    }
  }
  return [...ids];
}

/** Shipment solo après split : pas de suivi hérité du lot groupé (nouveau bordereau requis). */
async function prepareMemberIntakeSoloSplitShipment(
  service: SupabaseClient,
  shipmentId: string,
): Promise<void> {
  const sid = shipmentId.trim();
  if (!sid) return;

  await clearMemberIntakeShipmentTrackingFields(service, sid);

  const { data: dest } = await service
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", sid)
    .limit(1)
    .maybeSingle();
  if (!dest?.id) return;

  const prev =
    dest.metadata && typeof dest.metadata === "object" && !Array.isArray(dest.metadata)
      ? { ...(dest.metadata as Record<string, unknown>) }
      : {};
  delete prev.sendcloud_parcel_id;
  delete prev.sendcloud_return_order_number;
  delete prev.sc_outgoing_parcel_id;
  delete prev.sendcloud_panel_shipment_id;

  await service.from("shipment_destinations").update({ metadata: prev }).eq("id", dest.id);
}

async function clearMemberIntakeShipmentTrackingFields(
  service: SupabaseClient,
  shipmentId: string,
): Promise<string | null> {
  const sid = shipmentId.trim();
  if (!sid) return null;

  const { data: before } = await service
    .from("shipments")
    .select("tracking_number")
    .eq("id", sid)
    .maybeSingle();
  const previousTracking =
    typeof before?.tracking_number === "string" && before.tracking_number.trim()
      ? before.tracking_number.trim()
      : null;

  const nowIso = new Date().toISOString();
  const patch = {
    status: "pending" as const,
    tracking_number: null,
    member_tracking_url: null,
    ready_at: null,
    updated_at: nowIso,
  };

  const { data: updated, error } = await service
    .from("shipments")
    .update(patch)
    .eq("id", sid)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (!error && updated?.id) {
    return previousTracking;
  }

  const fallback = await service
    .from("shipments")
    .update(patch)
    .eq("id", sid)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (fallback.error) {
    console.warn("[member-intake-shipment] clear tracking", sid, fallback.error.message);
  }

  return previousTracking;
}

/** Crée ou réutilise l’expédition DB `member_intake` pour le portail (sans doublon). */
export async function ensureMemberIntakeShipmentForPortal(
  service: SupabaseClient,
  params: {
    ownerUserId: string;
    itemIds: string[];
    orderNumber: string;
    recipient: SendcloudOutboundRecipient;
    /** Toujours insérer une nouvelle ligne (ex. pièce secondaire après split). */
    forceCreate?: boolean;
    /** IDs shipment à ne jamais réutiliser (ex. lot fusionné conservé sur item_intake_1). */
    excludeShipmentIds?: string[];
  },
): Promise<{ ok: true; shipmentId: string; reused: boolean } | { ok: false; error: string }> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1) {
    return { ok: false, error: "Aucune pièce." };
  }

  const excluded = new Set(
    (params.excludeShipmentIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const acceptShipmentId = (id: string | null | undefined): string | null => {
    const trimmed = id?.trim();
    if (!trimmed || excluded.has(trimmed)) return null;
    return trimmed;
  };

  let shipmentId: string | null = null;
  const primaryItemId = primaryMemberIntakeItemId(sortedIds);
  let idsToSync = sortedIds;

  if (!params.forceCreate && sortedIds.length === 1) {
    try {
      const { fetchDefaultIntakeShippingGroupIds } = await import("./intake-cart-return-piggyback");
      const peerIds = await fetchDefaultIntakeShippingGroupIds(service, params.ownerUserId, {
        focusItemId: sortedIds[0]!,
      });
      if (peerIds.length >= 2) {
        idsToSync = peerIds;
      }
    } catch {
      /* import / peer lookup optional */
    }
  }

  if (!params.forceCreate) {
    const probeIds = idsToSync.length >= 2 ? idsToSync : sortedIds;
    const groupShipIds = await collectMemberIntakeShipmentIdsForGroup(service, probeIds);
    const keeper = await findMemberIntakeKeeperForGroup(service, groupShipIds, probeIds);
    if (keeper) {
      const mergedIds = [...new Set([...keeper.itemIds, ...probeIds])]
        .sort()
        .slice(0, MEMBER_INTAKE_SHIPMENT_MAX_ITEMS);
      const accepted = acceptShipmentId(keeper.id);
      if (
        accepted &&
        mergedIds.length <= MEMBER_INTAKE_SHIPMENT_MAX_ITEMS &&
        (mergedIds.length >= 2 || mergedIds.includes(sortedIds[0]!))
      ) {
        shipmentId = accepted;
        if (idsToSync.length >= 2) {
          idsToSync = mergedIds;
        }
      }
    }
  }

  if (!params.forceCreate && !shipmentId) {
    if (primaryItemId) {
      shipmentId = acceptShipmentId(
        await findMemberIntakeShipmentByItemIntakeId(service, primaryItemId),
      );
    }

    if (!shipmentId) {
      const { data: intakeRows } = await service
        .from("item_intake")
        .select("item_id, metadata")
        .in("item_id", sortedIds);

      for (const row of intakeRows ?? []) {
        const sid = readScMemberIntakeShipmentId(row.metadata);
        if (!sid) continue;
        const accepted = acceptShipmentId(sid);
        if (!accepted) continue;
        const loaded = await loadMemberIntakeShipment(service, accepted);
        if (loaded) {
          shipmentId = loaded.id;
          break;
        }
      }
    }

    if (!shipmentId) {
      shipmentId = acceptShipmentId(
        await findMemberIntakeShipmentByOrderNumber(service, params.orderNumber),
      );
    }
  }

  let reused = Boolean(shipmentId);

  if (!shipmentId) {
    const released = await archiveConflictingActiveMemberIntakeShipments(service, idsToSync);
    if (!released.ok) {
      return { ok: false, error: released.error };
    }

    const patch = buildMemberIntakeShipmentItemIntakePatch(sortedIds);
    if (!patch.item_intake_1_id) {
      return { ok: false, error: "Aucune pièce." };
    }
    const { data: inserted, error: insErr } = await service
      .from("shipments")
      .insert({
        cart_id: null,
        ...patch,
        context: "member_intake",
        status: "pending",
      })
      .select("id")
      .single();
    if (insErr || !inserted?.id) {
      return { ok: false, error: insErr?.message ?? "Création expédition intake impossible." };
    }
    shipmentId = String(inserted.id);
    reused = false;

    const { error: providerErr } = await service.rpc("set_shipment_provider", {
      p_shipment_id: shipmentId,
      p_provider_code: "sendcloud",
    });
    if (providerErr) {
      console.warn("[member-intake-shipment] set_shipment_provider", providerErr.message);
    }
  }

  const syncOrderNumber =
    idsToSync.length >= 2 ? buildStableMemberIntakeOrderNumber(idsToSync) : params.orderNumber;

  if (reused && idsToSync.length >= 2) {
    const groupShipIds = await collectMemberIntakeShipmentIdsForGroup(service, idsToSync);
    const attached = await attachMemberIntakeItemsToKeeperShipment(service, {
      keeperId: shipmentId!,
      itemIds: idsToSync,
      ownerUserId: params.ownerUserId,
      groupOrderNumber: syncOrderNumber,
      recipient: params.recipient,
      redundantShipmentIds: groupShipIds.filter((id) => id !== shipmentId),
      notes: "Regroupement intake : pièces ajoutées au colis existant (portail).",
    });
    if (!attached.ok) {
      return { ok: false, error: attached.error };
    }
    return { ok: true, shipmentId: shipmentId!, reused: true };
  }

  await ensureMemberIntakeDestination(service, shipmentId, {
    orderNumber: syncOrderNumber,
    itemIds: idsToSync,
    ownerUserId: params.ownerUserId,
    recipient: params.recipient,
  });

  const synced = await syncMemberIntakeShipmentItemIntakeLink(service, shipmentId, idsToSync, {
    mergeWithExistingSlots: reused && idsToSync.length >= 2,
  });
  if (!synced.ok) {
    return { ok: false, error: synced.error };
  }

  for (const id of idsToSync) {
    await patchItemIntakeSendcloudMetadata(service, id, {
      [SC_MEMBER_INTAKE_SHIPMENT_ID]: shipmentId,
    });
  }

  return { ok: true, shipmentId, reused };
}

/** Lie l’expédition Sendcloud technique (aller) et le colis sortant au shipment DB. */
export async function syncMemberIntakeShipmentPortalIds(
  service: SupabaseClient,
  params: {
    shipmentId: string;
    orderNumber: string;
    panelShipmentId: string;
    outboundParcelId?: number | null;
  },
): Promise<void> {
  const sid = params.shipmentId.trim();
  if (!sid) return;

  const metaPatch: Record<string, unknown> = {
    sendcloud_order_number: params.orderNumber.trim(),
    sendcloud_panel_shipment_id: params.panelShipmentId.trim(),
    sc_sendcloud_intake_portal_synced_at: new Date().toISOString(),
  };
  if (params.outboundParcelId != null && params.outboundParcelId > 0) {
    metaPatch.sc_outgoing_parcel_id = params.outboundParcelId;
  }

  const { data: existing } = await service
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", sid)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const prev =
      existing.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, unknown>)
        : {};
    await service
      .from("shipment_destinations")
      .update({ metadata: { ...prev, ...metaPatch } })
      .eq("id", existing.id);
  }
}

/** Réinitialisation portail : conserve le shipment DB, efface suivi / colis Sendcloud actifs. */
export async function resetMemberIntakeShipmentForPortal(
  service: SupabaseClient,
  params: {
    itemIds: string[];
    explicitShipmentIds?: string[];
    excludedReturnParcelIds?: number[];
    excludedReturnTrackingNumbers?: string[];
    orderNumbers?: string[];
    sendcloudEnv?: SendcloudEnv | null;
  },
): Promise<void> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length === 0 && (params.explicitShipmentIds?.length ?? 0) === 0) return;

  const orderNumbers = [
    ...new Set(
      (params.orderNumbers ?? [])
        .map((on) => on.trim())
        .filter(Boolean),
    ),
  ];

  const shipmentIds = new Set(
    await resolveMemberIntakeShipmentIdsForPortalReset(service, {
      itemIds: sortedIds,
      orderNumbers,
    }),
  );
  for (const sid of params.explicitShipmentIds ?? []) {
    const trimmed = sid.trim();
    if (trimmed) shipmentIds.add(trimmed);
  }

  const excludedReturnParcelIds = new Set(
    (params.excludedReturnParcelIds ?? []).filter((id) => Number.isFinite(id) && id > 0),
  );
  const excludedReturnTrackingNumbers = new Set(
    (params.excludedReturnTrackingNumbers ?? [])
      .map((tn) => String(tn ?? "").trim().toUpperCase())
      .filter((tn) => tn.length > 0),
  );

  const env = params.sendcloudEnv ?? getSendcloudEnv();
  if (env && orderNumbers.length > 0) {
    for (const shipmentId of shipmentIds) {
      const destMeta = await readMemberIntakeDestinationMetadata(service, shipmentId);
      const outgoingRaw = destMeta.sc_outgoing_parcel_id;
      const outgoingParcelId =
        typeof outgoingRaw === "number"
          ? outgoingRaw
          : typeof outgoingRaw === "string"
            ? parseInt(outgoingRaw, 10)
            : NaN;
      const fromSendcloud = await collectIntakeReturnParcelIdsFromSendcloudOrders(env, orderNumbers, {
        outgoingParcelId: Number.isFinite(outgoingParcelId) ? outgoingParcelId : null,
        dummyParcelId: Number.isFinite(outgoingParcelId) ? outgoingParcelId : null,
      });
      for (const pid of fromSendcloud) excludedReturnParcelIds.add(pid);
    }
  }

  for (const shipmentId of shipmentIds) {
    const previousTracking = await clearMemberIntakeShipmentTrackingFields(service, shipmentId);
    if (
      previousTracking &&
      isIntakeMemberReturnTrackingNumber(previousTracking)
    ) {
      excludedReturnTrackingNumbers.add(previousTracking.trim().toUpperCase());
    }

    const { data: dest } = await service
      .from("shipment_destinations")
      .select("id, metadata")
      .eq("shipment_id", shipmentId)
      .limit(1)
      .maybeSingle();

    if (dest?.id) {
      const prev =
        dest.metadata && typeof dest.metadata === "object"
          ? { ...(dest.metadata as Record<string, unknown>) }
          : {};
      delete prev.sendcloud_parcel_id;
      delete prev.sc_outgoing_parcel_id;
      delete prev.sendcloud_panel_shipment_id;
      delete prev.sc_sendcloud_intake_portal_synced_at;
      delete prev.sc_sendcloud_intake_return_parcel_at;
      delete prev.sendcloud_return_order_number;

      if (excludedReturnParcelIds.size > 0) {
        prev[SC_EXCLUDED_RETURN_PARCEL_IDS] = [
          ...new Set([...readExcludedReturnParcelIds(prev), ...excludedReturnParcelIds]),
        ];
      }
      if (excludedReturnTrackingNumbers.size > 0) {
        prev[SC_EXCLUDED_RETURN_TRACKING_NUMBERS] = [
          ...new Set([
            ...readExcludedReturnTrackingNumbers(prev),
            ...excludedReturnTrackingNumbers,
          ]),
        ];
      }

      // Conserve sendcloud_order_number + sc_return_portal_base_url
      await service.from("shipment_destinations").update({ metadata: prev }).eq("id", dest.id);
    }
  }
}

/**
 * Relève le colis retour Sendcloud (suivi XT) et l’aligne sur le shipment `member_intake`.
 */
export async function syncMemberIntakeReturnFromSendcloudByOrder(
  service: SupabaseClient,
  env: SendcloudEnv,
  params: {
    shipmentId: string;
    orderNumber: string;
    outgoingParcelId?: number | null;
    dummyParcelId?: number | null;
  },
): Promise<{ ok: true; synced: boolean; tracking_number?: string | null } | { ok: false; error: string }> {
  const orderNumber = params.orderNumber.trim();
  const shipmentId = params.shipmentId.trim();
  if (!orderNumber || !shipmentId) {
    return { ok: true, synced: false };
  }

  const destMeta = await readMemberIntakeDestinationMetadata(service, shipmentId);
  const parcels = await findSendcloudParcelsByOrderNumberV3(env, orderNumber);
  const exclude = new Set<number>();
  if (params.dummyParcelId != null && params.dummyParcelId > 0) exclude.add(params.dummyParcelId);
  if (params.outgoingParcelId != null && params.outgoingParcelId > 0) exclude.add(params.outgoingParcelId);
  for (const pid of readExcludedReturnParcelIds(destMeta)) exclude.add(pid);
  const excludedTracking = new Set(readExcludedReturnTrackingNumbers(destMeta));

  let chosen: (typeof parcels)[number] | null = null;
  for (const parcel of parcels) {
    const id = typeof parcel.id === "number" ? parcel.id : NaN;
    if (!Number.isFinite(id) || id <= 0 || exclude.has(id)) continue;
    const tn = String(parcel.tracking_number ?? "").trim();
    if (!isIntakeMemberReturnTrackingNumber(tn)) continue;
    if (excludedTracking.has(tn.toUpperCase())) continue;
    chosen = parcel;
    break;
  }

  if (!chosen?.id) {
    return { ok: true, synced: false };
  }

  const parcelId = chosen.id as number;
  const trackingNumber = String(chosen.tracking_number ?? "").trim() || null;
  const carrierUrl = buildCarrierTrackingUrlFromNumber(trackingNumber);

  const destOrder = String(destMeta.sendcloud_order_number ?? "").trim();
  if (destOrder && orderNumber.trim() !== destOrder) {
    return { ok: true, synced: false };
  }

  if (trackingNumber) {
    const { data: otherShips } = await service
      .from("shipments")
      .select("id")
      .eq("context", "member_intake")
      .eq("tracking_number", trackingNumber)
      .is("deleted_at", null)
      .neq("id", shipmentId)
      .limit(1);
    if (otherShips?.length) {
      const linkedIds = await resolveMemberIntakeItemIds(service, shipmentId);
      if (linkedIds.length === 1) {
        return { ok: true, synced: false };
      }
    }
  }

  await patchMemberIntakeShipmentReturnParcel(service, shipmentId, parcelId, { orderNumber });
  await syncMemberIntakeShipmentTracking(service, shipmentId, {
    trackingNumber,
    trackingUrl: carrierUrl,
  });

  if (trackingNumber && carrierUrl) {
    const itemIds = await resolveMemberIntakeItemIds(service, shipmentId);
    for (const itemId of itemIds) {
      await patchItemIntakeSendcloudMetadata(service, itemId, {
        numero_suivi: trackingNumber,
        lien_suivi: carrierUrl,
      });
    }
  }

  return { ok: true, synced: true, tracking_number: trackingNumber };
}

/** Suivi retour (XT) depuis le colis entrant portail ou, à défaut, la commande Sendcloud. */
export async function resolveMemberIntakeReturnTracking(
  env: SendcloudEnv,
  params: {
    orderNumber: string;
    incomingParcelId?: number | null;
    outgoingParcelId?: number | null;
    dummyParcelId?: number | null;
  },
): Promise<string | null> {
  const incomingId =
    params.incomingParcelId != null && params.incomingParcelId > 0 ? params.incomingParcelId : null;
  if (incomingId) {
    const snap = await fetchSendcloudParcel(env, incomingId);
    if (snap && !snap.isCancelled) {
      const tn = String(snap.trackingNumber ?? "").trim();
      if (isIntakeMemberReturnTrackingNumber(tn)) return tn;
    }
  }

  const parcels = await findSendcloudParcelsByOrderNumberV3(env, params.orderNumber.trim());
  const exclude = new Set<number>();
  if (params.dummyParcelId != null && params.dummyParcelId > 0) exclude.add(params.dummyParcelId);
  if (params.outgoingParcelId != null && params.outgoingParcelId > 0) exclude.add(params.outgoingParcelId);
  if (incomingId) exclude.add(incomingId);

  for (const parcel of parcels) {
    const id = typeof parcel.id === "number" ? parcel.id : NaN;
    if (!Number.isFinite(id) || id <= 0 || exclude.has(id)) continue;
    const tn = String(parcel.tracking_number ?? "").trim();
    if (isIntakeMemberReturnTrackingNumber(tn)) return tn;
  }
  return null;
}

/** Commande Sendcloud stable pour un lot de pièces intake (hash des ids triés). */
export function buildStableMemberIntakeOrderNumber(sortedIds: string[]): string {
  const sorted = [...new Set(sortedIds.map((x) => x.trim()).filter(Boolean))].sort();
  const shipmentKey = createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 16);
  return buildSendcloudOrderNumber({
    cartId: sorted[0]!,
    shipmentId: shipmentKey,
    generation: 1,
  });
}

function mergeMemberIntakeCancelInputs(
  a: MemberIntakeSendcloudCancelInput,
  b: MemberIntakeSendcloudCancelInput,
): MemberIntakeSendcloudCancelInput {
  return {
    orderNumbers: [...new Set([...a.orderNumbers, ...b.orderNumbers])],
    panelShipmentIds: [...new Set([...a.panelShipmentIds, ...b.panelShipmentIds])],
    trackingNumbers: [...new Set([...a.trackingNumbers, ...b.trackingNumbers])],
    parcelIds: [...new Set([...a.parcelIds, ...b.parcelIds])],
  };
}

async function loadMemberIntakeGroupCancelInput(
  service: SupabaseClient,
  params: { itemIds: string[]; groupOrderNumber: string },
): Promise<MemberIntakeSendcloudCancelInput> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  let merged = await loadMemberIntakeSendcloudCancelInput(service, {
    itemIds: sortedIds,
    defaultOrderNumber: params.groupOrderNumber,
  });

  const shipmentIds = new Set<string>();
  const { data: intakeRows } = await service
    .from("item_intake")
    .select("metadata")
    .in("item_id", sortedIds);
  for (const row of intakeRows ?? []) {
    const sid = readMemberIntakeShipmentIdFromMetadata(row.metadata);
    if (sid) shipmentIds.add(sid);
  }

  for (const sid of shipmentIds) {
    const destMeta = await readMemberIntakeDestinationMetadata(service, sid);
    const { data: ship } = await service
      .from("shipments")
      .select("tracking_number")
      .eq("id", sid)
      .maybeSingle();
    const tracking =
      typeof ship?.tracking_number === "string" ? ship.tracking_number.trim() : null;
    const partial = gatherMemberIntakeSendcloudCancelInput([], {
      defaultOrderNumber: params.groupOrderNumber,
      destinationMetadata: destMeta,
      shipmentTrackingNumber: tracking,
    });
    merged = mergeMemberIntakeCancelInputs(merged, partial);
  }

  const orderSet = new Set(merged.orderNumbers);
  for (const id of sortedIds) {
    pushOrderNumber(orderSet, buildStableMemberIntakeOrderNumber([id]));
  }
  merged.orderNumbers = [...orderSet];
  return merged;
}

function readSendcloudField(metadata: unknown, key: string): string | null {
  if (!isPlainRecord(metadata)) return null;
  const sc = metadata.sendcloud;
  if (!isPlainRecord(sc)) return null;
  const v = sc[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isMemberIntakeShipmentMergeEligible(status: string): boolean {
  const s = String(status ?? "pending").toLowerCase();
  return s === "pending" || s === "ready";
}

/** Colis actif sans retour XT — peut être archivé lors d'un conflit de slots. */
function isMemberIntakeShipmentAttachable(status: string, trackingNumber: string | null | undefined): boolean {
  if (!isMemberIntakeShipmentMergeEligible(status)) return false;
  const tn = trackingNumber?.trim();
  if (tn && isIntakeMemberReturnTrackingNumber(tn)) return false;
  return true;
}

async function readMemberIntakeShipmentTrackingRow(
  service: SupabaseClient,
  shipmentId: string,
): Promise<{ trackingNumber: string | null; trackingUrl: string | null }> {
  const { data } = await service
    .from("shipments")
    .select("tracking_number, member_tracking_url")
    .eq("id", shipmentId.trim())
    .maybeSingle();
  return {
    trackingNumber:
      typeof data?.tracking_number === "string" && data.tracking_number.trim()
        ? data.tracking_number.trim()
        : null,
    trackingUrl:
      typeof data?.member_tracking_url === "string" && data.member_tracking_url.trim()
        ? data.member_tracking_url.trim()
        : null,
  };
}

/** Recopie le suivi retour XT (shipment source ou metadata intake) sur le colis conservé. */
async function promoteMemberIntakeReturnTrackingToKeeper(
  service: SupabaseClient,
  keeperId: string,
  sourceShipmentIds: string[],
  itemIds: string[],
): Promise<void> {
  const keeperTracking = await readMemberIntakeShipmentTrackingRow(service, keeperId);
  if (isIntakeMemberReturnTrackingNumber(keeperTracking.trackingNumber)) return;

  for (const sid of sourceShipmentIds) {
    if (sid.trim() === keeperId.trim()) continue;
    const src = await readMemberIntakeShipmentTrackingRow(service, sid);
    if (isIntakeMemberReturnTrackingNumber(src.trackingNumber)) {
      await syncMemberIntakeShipmentTracking(service, keeperId, {
        trackingNumber: src.trackingNumber,
        trackingUrl: src.trackingUrl,
      });
      return;
    }
  }

  const sortedIds = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))];
  if (sortedIds.length === 0) return;

  const { data: intakeRows } = await service
    .from("item_intake")
    .select("item_id, metadata")
    .in("item_id", sortedIds);

  for (const row of intakeRows ?? []) {
    if (readShippingPreferSolo(row.metadata)) continue;
    const label = parseIntakeShippingLabelFromMetadata(row.metadata);
    const tn = label?.numero_suivi?.trim() ?? "";
    if (!isIntakeMemberReturnTrackingNumber(tn)) continue;
    const url = label?.lien_suivi?.trim() || buildCarrierTrackingUrlFromNumber(tn);
    await syncMemberIntakeShipmentTracking(service, keeperId, {
      trackingNumber: tn,
      trackingUrl: url,
    });
    return;
  }
}

/**
 * Un item_intake ne peut figurer que sur un seul shipment `member_intake` actif pending/ready.
 * Archive les autres (soft-delete → annulation Sendcloud via trigger DB + archiveMemberIntakeShipment).
 */
async function archiveConflictingActiveMemberIntakeShipments(
  service: SupabaseClient,
  itemIds: string[],
  keepShipmentId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const keep = keepShipmentId?.trim() ?? "";
  const uniqueItems = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))];
  if (uniqueItems.length === 0) return { ok: true };

  const toArchive = new Set<string>();
  for (const itemId of uniqueItems) {
    const { data, error } = await service
      .from("shipments")
      .select("id, status, tracking_number")
      .eq("context", "member_intake")
      .is("deleted_at", null)
      .or(memberIntakeShipmentItemIntakeOrFilter(itemId));
    if (error) return { ok: false, error: error.message };

    for (const row of data ?? []) {
      const r = row as unknown as Record<string, unknown>;
      const sid = String(r.id ?? "").trim();
      if (!sid || (keep && sid === keep)) continue;
      const status = String(r.status ?? "pending");
      const tn = typeof r.tracking_number === "string" ? r.tracking_number : null;
      if (!isMemberIntakeShipmentAttachable(status, tn)) continue;
      toArchive.add(sid);
    }
  }

  for (const sid of toArchive) {
    const archived = await archiveMemberIntakeShipment(service, sid);
    if (!archived.ok) return { ok: false, error: archived.error };
  }
  return { ok: true };
}

/** Colis `member_intake` à conserver au regroupement (pending/ready). */
async function findMemberIntakeKeeperForGroup(
  service: SupabaseClient,
  shipmentIds: string[],
  sortedItemIds: string[] = [],
): Promise<{ id: string; itemIds: string[]; hasReturnTracking: boolean } | null> {
  const uniqueIds = [...new Set(shipmentIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return null;

  const primaryItemId = primaryMemberIntakeItemId(sortedItemIds);

  const { data } = await service
    .from("shipments")
    .select(
      `id, status, tracking_number, created_at, ${MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS.join(", ")}`,
    )
    .in("id", uniqueIds)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  let best: {
    id: string;
    itemIds: string[];
    itemCount: number;
    createdAt: string;
    hasReturnTracking: boolean;
    hasPrimaryItem: boolean;
  } | null = null;

  for (const row of data ?? []) {
    const r = row as unknown as Record<string, unknown>;
    const status = String(r.status ?? "pending");
    if (!isMemberIntakeShipmentMergeEligible(status)) continue;

    const tn = typeof r.tracking_number === "string" ? r.tracking_number : null;
    const hasReturnTracking = isIntakeMemberReturnTrackingNumber(tn);
    const itemIds = readMemberIntakeIdsFromShipmentRow(r);
    if (itemIds.length === 0) continue;

    const hasPrimaryItem = Boolean(primaryItemId && itemIds.includes(primaryItemId));
    const createdAt = String(r.created_at ?? "");
    const candidate = {
      id: String(r.id),
      itemIds,
      itemCount: itemIds.length,
      createdAt,
      hasReturnTracking,
      hasPrimaryItem,
    };

    if (
      !best ||
      (candidate.hasPrimaryItem && !best.hasPrimaryItem) ||
      (candidate.hasPrimaryItem === best.hasPrimaryItem &&
        candidate.hasReturnTracking &&
        !best.hasReturnTracking) ||
      (candidate.hasPrimaryItem === best.hasPrimaryItem &&
        candidate.hasReturnTracking === best.hasReturnTracking &&
        (candidate.itemCount > best.itemCount ||
          (candidate.itemCount === best.itemCount && candidate.createdAt < best.createdAt)))
    ) {
      best = candidate;
    }
  }

  return best
    ? { id: best.id, itemIds: best.itemIds, hasReturnTracking: best.hasReturnTracking }
    : null;
}

/** Regroupement léger : fusion sur le colis conservé, archive les doublons (solo post-split inclus). */
function canLightMergeMemberIntakeGroup(
  sortedIds: string[],
  _intakeMetas: unknown[],
  _keeper: { id: string; hasReturnTracking: boolean },
): boolean {
  return sortedIds.length >= 2;
}

/** Ajoute des pièces au colis existant, archive les doublons (annulation Sendcloud à l'archivage). */
async function attachMemberIntakeItemsToKeeperShipment(
  service: SupabaseClient,
  params: {
    keeperId: string;
    itemIds: string[];
    ownerUserId: string;
    groupOrderNumber: string;
    recipient: SendcloudOutboundRecipient;
    redundantShipmentIds?: string[];
    notes?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1) return { ok: false, error: "Aucune pièce." };

  const keeperId = params.keeperId.trim();
  const redundant = [...new Set((params.redundantShipmentIds ?? []).map((id) => id.trim()).filter(Boolean))]
    .filter((id) => id !== keeperId);

  const keeperTrackingBefore = await readMemberIntakeShipmentTrackingRow(service, keeperId);
  const keeperHasReturn = isIntakeMemberReturnTrackingNumber(keeperTrackingBefore.trackingNumber);

  await promoteMemberIntakeReturnTrackingToKeeper(service, keeperId, redundant, sortedIds);

  const keeperTrackingAfter = await readMemberIntakeShipmentTrackingRow(service, keeperId);
  const keeperHasReturnTracking =
    keeperHasReturn || isIntakeMemberReturnTrackingNumber(keeperTrackingAfter.trackingNumber);

  for (const sid of redundant) {
    const loaded = await loadMemberIntakeShipment(service, sid);
    if (!loaded) continue;
    const archived = await archiveMemberIntakeShipment(service, sid);
    if (!archived.ok) return { ok: false, error: archived.error };
  }

  const keeperDest = await readMemberIntakeDestinationMetadata(service, keeperId);
  const prevOrder = String(keeperDest.sendcloud_order_number ?? "").trim();
  const orderChanged = Boolean(prevOrder && prevOrder !== params.groupOrderNumber);
  const stableOrderNumber =
    keeperHasReturnTracking && prevOrder ? prevOrder : params.groupOrderNumber;

  await ensureMemberIntakeDestination(service, keeperId, {
    orderNumber: stableOrderNumber,
    itemIds: sortedIds,
    ownerUserId: params.ownerUserId,
    recipient: params.recipient,
  });
  const synced = await syncMemberIntakeShipmentItemIntakeLink(service, keeperId, sortedIds, {
    mergeWithExistingSlots: true,
  });
  if (!synced.ok) return synced;

  const env = getSendcloudEnv();
  if (orderChanged && !keeperHasReturnTracking) {
    await resetMemberIntakeShipmentForPortal(service, {
      itemIds: sortedIds,
      explicitShipmentIds: [keeperId],
      orderNumbers: [prevOrder],
      sendcloudEnv: env,
    });
  }

  const mergeCsv = sortedIds.join(",");
  const notes = (
    params.notes ?? "Regroupement intake : pièces fusionnées sur un colis member_intake existant."
  ).slice(0, 2000);
  const now = new Date().toISOString();

  let sharedReturnTracking: { trackingNumber: string; trackingUrl: string | null } | null = null;
  if (keeperHasReturnTracking) {
    const finalTracking = await readMemberIntakeShipmentTrackingRow(service, keeperId);
    if (isIntakeMemberReturnTrackingNumber(finalTracking.trackingNumber)) {
      sharedReturnTracking = {
        trackingNumber: finalTracking.trackingNumber!,
        trackingUrl: finalTracking.trackingUrl,
      };
    }
  }

  for (const id of sortedIds) {
    const patch: Record<string, string> = {
      [SC_MEMBER_INTAKE_SHIPMENT_ID]: keeperId,
    };
    if (sortedIds.length >= 2) {
      patch.sc_merge_item_ids = mergeCsv;
      patch.sc_order_number = stableOrderNumber;
      patch.reference_expedition = stableOrderNumber;
      patch.notes_interne = notes;
      patch.last_backoffice_update_at = now;
    }
    if (sharedReturnTracking) {
      patch.numero_suivi = sharedReturnTracking.trackingNumber;
      if (sharedReturnTracking.trackingUrl) {
        patch.lien_suivi = sharedReturnTracking.trackingUrl;
      }
    }
    const patchRes = await patchItemIntakeSendcloudMetadata(
      service,
      id,
      patch,
      orderChanged && !keeperHasReturnTracking
        ? {
            removeKeys: [
              SC_SHIPPING_PREFER_SOLO,
              "numero_suivi",
              "lien_suivi",
              "label_url",
              "sc_return_portal_url",
            ],
          }
        : sortedIds.length >= 2
          ? { removeKeys: [SC_SHIPPING_PREFER_SOLO] }
          : undefined,
    );
    if (!patchRes.ok) return { ok: false, error: patchRes.message };
  }

  if (keeperHasReturnTracking && sharedReturnTracking) {
    const pruneEnv = getSendcloudEnv();
    if (pruneEnv) {
      await pruneStaleSendcloudReturnsForOrder(pruneEnv, params.groupOrderNumber, [
        sharedReturnTracking.trackingNumber,
      ]).catch(() => undefined);
      for (const id of sortedIds) {
        const soloOrder = buildStableMemberIntakeOrderNumber([id]);
        if (soloOrder !== params.groupOrderNumber) {
          await pruneStaleSendcloudReturnsForOrder(pruneEnv, soloOrder, [
            sharedReturnTracking.trackingNumber,
          ]).catch(() => undefined);
        }
      }
    }
  }

  return { ok: true };
}

function memberAsRecipientForConsolidation(user: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  adress: string | null;
}): SendcloudOutboundRecipient | { error: string } {
  const fn = user.first_name?.trim() ?? "";
  const ln = user.last_name?.trim() ?? "";
  const email = user.email?.trim() ?? "";
  const phone = String(user.phone ?? "").replace(/\s/g, "").trim();
  const parsed = parseMemberAdressForShipment(user.adress);
  if (!fn || !ln || !email || !phone) {
    return { error: "Complète prénom, nom, email et téléphone dans ton profil." };
  }
  if (!parsed?.sender_street || !parsed.sender_postcode || !parsed.sender_city) {
    return { error: "Complète ton adresse postale dans ton profil (rue, n°, CP, ville)." };
  }
  const country = (parsed.sender_country?.trim().toUpperCase() || "FR").slice(0, 2);
  return {
    name: `${fn} ${ln}`.trim().slice(0, 64),
    addressLine1: parsed.sender_street.trim().slice(0, 64),
    houseNumber: parsed.sender_houseno?.trim().slice(0, 16) || "1",
    postalCode: parsed.sender_postcode.replace(/\D/g, "").slice(0, 5),
    city: parsed.sender_city.slice(0, 64),
    countryCode: country.length === 2 ? country : "FR",
    phone: (normalizeFrenchPhoneToE164(phone) || "+33600000000").slice(0, 32),
    email: email.slice(0, 128),
  };
}

/** Détecte un lot intake scindé (solo, plusieurs shipments, commandes Sendcloud divergentes). */
export function needsMemberIntakeGroupConsolidation(
  targetIds: string[],
  intakeMetas: unknown[],
): boolean {
  if (targetIds.length < 2) return false;

  const targetKey = [...targetIds].sort().join(",");
  const groupOrder = buildStableMemberIntakeOrderNumber(targetIds);
  const shipmentIds = new Set<string>();
  let declaredMerge = false;

  for (const meta of intakeMetas) {
    if (readShippingPreferSolo(meta)) return true;

    const sid = readMemberIntakeShipmentIdFromMetadata(meta);
    if (sid) shipmentIds.add(sid);

    const mergeIds = parseScMergeItemIdsFromIntakeMetadata(meta);
    if (mergeIds.length >= 2) {
      declaredMerge = true;
      const mergeKey = [...mergeIds].sort().join(",");
      if (mergeKey !== targetKey) return true;
    }

    const sc = parseSendcloudFromIntakeMetadata(meta);
    const orderOnItem =
      sc?.reference_expedition?.trim() || readSendcloudField(meta, "sc_order_number") || null;
    if (orderOnItem && orderOnItem !== groupOrder) return true;

    const label = parseIntakeShippingLabelFromMetadata(meta);
    const portalUrl = readSendcloudField(meta, "sc_return_portal_url");
    if (label?.label_url?.startsWith("http") || label?.numero_suivi?.trim()) {
      if (mergeIds.length < 2 || [...mergeIds].sort().join(",") !== targetKey) return true;
    }
    if (portalUrl?.startsWith("http")) {
      if (mergeIds.length < 2 || [...mergeIds].sort().join(",") !== targetKey) return true;
    }
  }

  if (shipmentIds.size > 1) return true;
  if (!declaredMerge && targetIds.length >= 2) {
    for (const meta of intakeMetas) {
      const label = parseIntakeShippingLabelFromMetadata(meta);
      if (label?.label_url?.startsWith("http") || label?.numero_suivi?.trim()) return true;
      if (readSendcloudField(meta, "sc_return_portal_url")?.startsWith("http")) return true;
    }
  }

  return false;
}

/**
 * Regroupement après séparation : annule retours / bordereaux solo Sendcloud,
 * archive les shipments `member_intake` existants, recrée un seul shipment pour le lot.
 */
export async function consolidateMemberIntakeShippingGroup(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[] },
): Promise<
  | { ok: true; consolidated: false; item_ids: string[] }
  | { ok: true; consolidated: true; shipment_id: string; item_ids: string[] }
  | { ok: false; error: string }
> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 2 || sortedIds.length > MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) {
    return {
      ok: false,
      error: `Entre 2 et ${MEMBER_INTAKE_SHIPMENT_MAX_ITEMS} pièces requises pour regrouper.`,
    };
  }

  const groupOrderNumber = buildStableMemberIntakeOrderNumber(sortedIds);

  const { data: intakeRows, error: intakeErr } = await service
    .from("item_intake")
    .select("item_id, metadata")
    .in("item_id", sortedIds);
  if (intakeErr) return { ok: false, error: intakeErr.message };

  const metas = (intakeRows ?? []).map((r) => r.metadata);
  if (!needsMemberIntakeGroupConsolidation(sortedIds, metas)) {
    return { ok: true, consolidated: false, item_ids: sortedIds };
  }

  const shipmentIdsInGroup = await collectMemberIntakeShipmentIdsForGroup(service, sortedIds);
  const keeper = await findMemberIntakeKeeperForGroup(service, shipmentIdsInGroup, sortedIds);

  if (keeper && canLightMergeMemberIntakeGroup(sortedIds, metas, keeper)) {
    const { data: member, error: memErr } = await service
      .from("users")
      .select("first_name,last_name,email,phone,adress")
      .eq("id", params.userId)
      .maybeSingle();
    if (memErr || !member) {
      return { ok: false, error: "Profil membre introuvable." };
    }

    const recipient = memberAsRecipientForConsolidation(
      member as Parameters<typeof memberAsRecipientForConsolidation>[0],
    );
    if ("error" in recipient) {
      return { ok: false, error: recipient.error };
    }

    const attached = await attachMemberIntakeItemsToKeeperShipment(service, {
      keeperId: keeper.id,
      itemIds: sortedIds,
      ownerUserId: params.userId,
      groupOrderNumber,
      recipient,
      redundantShipmentIds: shipmentIdsInGroup.filter((id) => id !== keeper.id),
      notes:
        "Regroupement intake : colis fusionné, envois solo redondants archivés (retour conservé sur la pièce principale).",
    });
    if (!attached.ok) {
      return { ok: false, error: attached.error };
    }

    return {
      ok: true,
      consolidated: true,
      shipment_id: keeper.id,
      item_ids: sortedIds,
    };
  }

  const shipmentIdsToArchive = shipmentIdsInGroup;

  const env = getSendcloudEnv();
  if (env) {
    const cancelInput = await loadMemberIntakeGroupCancelInput(service, {
      itemIds: sortedIds,
      groupOrderNumber,
    });
    const cancelled = await cancelMemberIntakeSendcloudArtifacts(env, cancelInput);
    if (!cancelled.ok) {
      return { ok: false, error: cancelled.error };
    }
  }

  for (const sid of shipmentIdsToArchive) {
    const archived = await archiveMemberIntakeShipment(service, sid, { skipSendcloudCancel: true });
    if (!archived.ok) {
      console.warn("[consolidateMemberIntakeShippingGroup] archive shipment", sid, archived.error);
      return { ok: false, error: archived.error };
    }
  }

  for (const id of sortedIds) {
    await clearItemIntakeShippingLabelMetadata(service, id);
    await patchItemIntakeSendcloudMetadata(
      service,
      id,
      {},
      { removeKeys: [SC_MEMBER_INTAKE_SHIPMENT_ID] },
    );
  }

  const { data: member, error: memErr } = await service
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", params.userId)
    .maybeSingle();
  if (memErr || !member) {
    return { ok: false, error: "Profil membre introuvable." };
  }

  const recipient = memberAsRecipientForConsolidation(
    member as Parameters<typeof memberAsRecipientForConsolidation>[0],
  );
  if ("error" in recipient) {
    return { ok: false, error: recipient.error };
  }

  const ensured = await ensureMemberIntakeShipmentForPortal(service, {
    ownerUserId: params.userId,
    itemIds: sortedIds,
    orderNumber: groupOrderNumber,
    recipient,
  });
  if (!ensured.ok) {
    return { ok: false, error: ensured.error };
  }

  await resetMemberIntakeShipmentForPortal(service, { itemIds: sortedIds });

  const mergeCsv = sortedIds.join(",");
  const notes =
    "Regroupement intake : retours solo annulés, expédition unique member_intake.".slice(0, 2000);
  const now = new Date().toISOString();

  for (const id of sortedIds) {
    const patchRes = await patchItemIntakeSendcloudMetadata(
      service,
      id,
      {
        [SC_MEMBER_INTAKE_SHIPMENT_ID]: ensured.shipmentId,
        sc_merge_item_ids: mergeCsv,
        sc_order_number: groupOrderNumber,
        reference_expedition: groupOrderNumber,
        notes_interne: notes,
        last_backoffice_update_at: now,
      },
      { removeKeys: [SC_SHIPPING_PREFER_SOLO, "numero_suivi", "lien_suivi", "label_url", "sc_return_portal_url"] },
    );
    if (!patchRes.ok) {
      return { ok: false, error: patchRes.message };
    }
  }

  return {
    ok: true,
    consolidated: true,
    shipment_id: ensured.shipmentId,
    item_ids: sortedIds,
  };
}

/** Annule les retours Sendcloud obsolètes pour une commande (garde les XT actifs). */
export async function pruneStaleSendcloudReturnsForOrder(
  env: SendcloudEnv,
  orderNumber: string,
  keepTrackingNumbers: string[] = [],
): Promise<{ ok: true; cancelledIds: number[] } | { ok: false; error: string }> {
  const on = orderNumber.trim();
  if (!on) return { ok: true, cancelledIds: [] };

  const keep = new Set(
    keepTrackingNumbers.map((tn) => String(tn ?? "").trim().toUpperCase()).filter(Boolean),
  );
  const found = await findSendcloudReturnsByOrderNumber(env, on);
  if (!found.ok) return found;

  const cancelledIds: number[] = [];
  for (const row of found.returns) {
    if (typeof row.id !== "number" || row.id <= 0) continue;
    const tn = String(row.tracking_number ?? "").trim().toUpperCase();
    if (tn && keep.has(tn)) continue;
    const cancelled = await cancelSendcloudReturnV3(env, row.id);
    if (cancelled.ok) cancelledIds.push(row.id);
  }

  return { ok: true, cancelledIds };
}

type MemberIntakeSplitKeeperResolution = {
  keptShipmentId: string | null;
  keeperItemId: string;
};

function sendcloudOrderCartId8(orderNumber: string): string | null {
  const match = orderNumber.trim().toLowerCase().match(/^segna-([a-f0-9]{8})(?:-|$)/);
  return match?.[1] ?? null;
}

function itemIdMatchesSendcloudOrderCartPrefix(itemId: string, orderNumber: string): boolean {
  const prefix = sendcloudOrderCartId8(orderNumber);
  if (!prefix) return false;
  return itemId.replace(/-/g, "").slice(0, 8).toLowerCase() === prefix;
}

function readIntakeSendcloudOrderFromMetadata(metadata: unknown): string | null {
  const sc = parseSendcloudFromIntakeMetadata(metadata);
  const fromSc = sc?.reference_expedition?.trim();
  if (fromSc) return fromSc;
  return readSendcloudField(metadata, "sc_order_number") || readSendcloudField(metadata, "reference_expedition");
}

function collectSplitKeeperOrderCandidates(
  sortedItemIds: string[],
  linkedSlotIds: string[],
  options: {
    destinationOrderNumber?: string | null;
    intakeMetaByItemId?: Map<string, unknown>;
  },
): string[] {
  const orders: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const on = String(raw ?? "").trim();
    if (!on || seen.has(on)) return;
    seen.add(on);
    orders.push(on);
  };

  push(options.destinationOrderNumber);
  for (const id of linkedSlotIds) {
    push(readIntakeSendcloudOrderFromMetadata(options.intakeMetaByItemId?.get(id)));
  }
  for (const id of sortedItemIds) {
    push(readIntakeSendcloudOrderFromMetadata(options.intakeMetaByItemId?.get(id)));
  }
  return orders;
}

function resolveSplitKeeperItemFromOrderCandidates(
  sortedItemIds: string[],
  orderCandidates: string[],
): string | null {
  for (const order of orderCandidates) {
    for (const id of sortedItemIds) {
      if (itemIdMatchesSendcloudOrderCartPrefix(id, order)) return id;
    }
    for (const id of sortedItemIds) {
      if (buildStableMemberIntakeOrderNumber([id]) === order) return id;
    }
    const primaryId = primaryMemberIntakeItemId(sortedItemIds);
    if (primaryId && buildStableMemberIntakeOrderNumber(sortedItemIds) === order) {
      return primaryId;
    }
  }
  return null;
}

/** Pièce « propriétaire » du bordereau : commande Sendcloud, slot 1 du lot, puis repli. */
function resolveSplitKeeperItemForShipment(
  sortedItemIds: string[],
  shipmentRow: Record<string, unknown>,
  options: {
    destinationOrderNumber?: string | null;
    intakeMetaByItemId?: Map<string, unknown>;
  },
): string {
  const sortedSet = new Set(sortedItemIds.map((id) => id.trim()).filter(Boolean));
  const primaryId = primaryMemberIntakeItemId(sortedItemIds) ?? sortedItemIds[0] ?? "";
  const linked = readMemberIntakeIdsFromShipmentRow(shipmentRow).filter((id) => sortedSet.has(id));
  const shipmentTn =
    typeof shipmentRow.tracking_number === "string" ? shipmentRow.tracking_number.trim() : "";
  const orderCandidates = collectSplitKeeperOrderCandidates(sortedItemIds, linked, options);

  const fromOrder = resolveSplitKeeperItemFromOrderCandidates(sortedItemIds, orderCandidates);
  if (fromOrder) return fromOrder;

  if (options.intakeMetaByItemId && isIntakeMemberReturnTrackingNumber(shipmentTn)) {
    const tnKey = shipmentTn.toUpperCase();
    for (const id of linked) {
      const label = parseIntakeShippingLabelFromMetadata(options.intakeMetaByItemId.get(id));
      if (label?.numero_suivi?.trim().toUpperCase() === tnKey) return id;
    }
    for (const id of sortedItemIds) {
      if (linked.includes(id)) continue;
      const label = parseIntakeShippingLabelFromMetadata(options.intakeMetaByItemId.get(id));
      if (label?.numero_suivi?.trim().toUpperCase() === tnKey) return id;
    }
  }

  if (linked.length >= 1 && isIntakeMemberReturnTrackingNumber(shipmentTn)) {
    return linked[0]!;
  }

  if (linked.length === 1) return linked[0]!;

  const item1 = String(shipmentRow.item_intake_1_id ?? "").trim();
  if (item1 && sortedSet.has(item1)) return item1;

  return primaryId;
}

/**
 * Au split : la pièce propriétaire du bordereau Sendcloud conserve le shipment ;
 * sinon repli sur le lot fusionné / pièce principale triée.
 */
async function resolveMemberIntakeSplitKeeper(
  service: SupabaseClient,
  sortedItemIds: string[],
  shipmentIds: string[],
): Promise<MemberIntakeSplitKeeperResolution> {
  const sortedSet = new Set(sortedItemIds.map((id) => id.trim()).filter(Boolean));
  const fallbackItemId = primaryMemberIntakeItemId(sortedItemIds) ?? sortedItemIds[0] ?? "";

  if (shipmentIds.length === 0 || !fallbackItemId) {
    return { keptShipmentId: null, keeperItemId: fallbackItemId };
  }

  const { data: intakeRows } = await service
    .from("item_intake")
    .select("item_id, metadata")
    .in("item_id", sortedItemIds);
  const intakeMetaByItemId = new Map<string, unknown>();
  for (const row of intakeRows ?? []) {
    intakeMetaByItemId.set(String((row as { item_id?: string }).item_id ?? ""), row.metadata);
  }

  const slotCols = MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS.join(", ");
  const { data: shipRows } = await service
    .from("shipments")
    .select(`id, tracking_number, ${slotCols}`)
    .in("id", shipmentIds)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  for (const row of shipRows ?? []) {
    const r = row as unknown as Record<string, unknown>;
    const tn = typeof r.tracking_number === "string" ? r.tracking_number : null;
    if (!isIntakeMemberReturnTrackingNumber(tn)) continue;

    const linked = readMemberIntakeIdsFromShipmentRow(r).filter((id) => sortedSet.has(id));
    if (linked.length === 0) continue;

    const shipmentId = String(r.id);
    const destMeta = await readMemberIntakeDestinationMetadata(service, shipmentId);
    const destOrder = String(destMeta.sendcloud_order_number ?? "").trim() || null;
    const keeperItemId = resolveSplitKeeperItemForShipment(sortedItemIds, r, {
      destinationOrderNumber: destOrder,
      intakeMetaByItemId,
    });
    return { keptShipmentId: shipmentId, keeperItemId };
  }

  for (const row of intakeRows ?? []) {
    const itemId = String((row as { item_id?: string }).item_id ?? "").trim();
    if (!sortedSet.has(itemId)) continue;
    const label = parseIntakeShippingLabelFromMetadata((row as { metadata?: unknown }).metadata);
    if (!isIntakeMemberReturnTrackingNumber(label?.numero_suivi)) continue;

    const sid = readMemberIntakeShipmentIdFromMetadata((row as { metadata?: unknown }).metadata);
    if (!sid || !shipmentIds.includes(sid)) continue;

    const keptRow = (shipRows ?? []).find(
      (s) => String((s as { id?: string }).id ?? "") === sid,
    ) as Record<string, unknown> | undefined;
    const destMeta = await readMemberIntakeDestinationMetadata(service, sid);
    const destOrder = String(destMeta.sendcloud_order_number ?? "").trim() || null;
    const keeperItemId = keptRow
      ? resolveSplitKeeperItemForShipment(sortedItemIds, keptRow, {
          destinationOrderNumber: destOrder,
          intakeMetaByItemId,
        })
      : itemId;
    return { keptShipmentId: sid, keeperItemId };
  }

  const keptShipmentId = await findMergedMemberIntakeShipmentIdForSplit(
    service,
    shipmentIds,
    sortedItemIds,
    shipRows ?? [],
  );

  let keeperItemId = fallbackItemId;
  if (keptShipmentId) {
    const keptRow = (shipRows ?? []).find(
      (r) => String((r as { id?: string }).id ?? "") === keptShipmentId,
    ) as Record<string, unknown> | undefined;
    if (keptRow) {
      const destMeta = await readMemberIntakeDestinationMetadata(service, keptShipmentId);
      const destOrder = String(destMeta.sendcloud_order_number ?? "").trim() || null;
      keeperItemId = resolveSplitKeeperItemForShipment(sortedItemIds, keptRow, {
        destinationOrderNumber: destOrder,
        intakeMetaByItemId,
      });
    }
  }

  return { keptShipmentId, keeperItemId };
}

/** Shipment fusionné à conserver au split : suivi XT, lot multi-pièces ou pièce principale. */
async function findMergedMemberIntakeShipmentIdForSplit(
  service: SupabaseClient,
  shipmentIds: string[],
  sortedItemIds: string[],
  prefetchedRows?: unknown[],
): Promise<string | null> {
  if (shipmentIds.length === 0) return null;

  const sortedSet = new Set(sortedItemIds.map((id) => id.trim()).filter(Boolean));
  const primaryItemId = sortedItemIds[0] ?? null;

  const slotCols = MEMBER_INTAKE_SHIPMENT_ITEM_INTAKE_COLUMNS.join(", ");
  const data =
    prefetchedRows ??
    (
      await service
        .from("shipments")
        .select(`id, tracking_number, ${slotCols}`)
        .in("id", shipmentIds)
        .eq("context", "member_intake")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
    ).data;

  for (const row of data ?? []) {
    const r = row as unknown as Record<string, unknown>;
    const tn = typeof r.tracking_number === "string" ? r.tracking_number : null;
    if (!isIntakeMemberReturnTrackingNumber(tn)) continue;
    const linked = readMemberIntakeIdsFromShipmentRow(r).filter((id) => sortedSet.has(id));
    if (linked.length > 0) return String(r.id);
  }

  let slotBest: { id: string; count: number } | null = null;
  for (const row of data ?? []) {
    const linked = readMemberIntakeIdsFromShipmentRow(row as Record<string, unknown>);
    if (linked.length < 2) continue;
    if (!slotBest || linked.length > slotBest.count) {
      slotBest = { id: String((row as { id: string }).id), count: linked.length };
    }
  }
  if (slotBest) return slotBest.id;

  let destBest: { id: string; count: number } | null = null;
  for (const sid of shipmentIds) {
    const destMeta = await readMemberIntakeDestinationMetadata(service, sid);
    const csv = destMeta[DEST_INTAKE_ITEM_IDS];
    if (typeof csv !== "string" || !csv.trim()) continue;
    const inGroup = csv
      .split(",")
      .map((x) => x.trim())
      .filter((id) => sortedSet.has(id));
    if (inGroup.length < 2) continue;
    if (!destBest || inGroup.length > destBest.count) {
      destBest = { id: sid, count: inGroup.length };
    }
  }
  if (destBest) return destBest.id;

  if (primaryItemId) {
    const { data: byPrimary } = await service
      .from("shipments")
      .select("id")
      .in("id", shipmentIds)
      .eq("context", "member_intake")
      .eq("item_intake_1_id", primaryItemId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byPrimary?.id) return String(byPrimary.id);
  }

  if (shipmentIds.length === 1) return shipmentIds[0]!;

  return null;
}

/**
 * Séparation d’un lot groupé : conserve le shipment (et le suivi XT) de la pièce qui a déjà
 * un bordereau ; crée un shipment + aller factice solo par pièce restante.
 */
export async function splitMemberIntakeShippingGroup(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[] },
): Promise<
  | { ok: true; primary_item_id: string; item_shipment_ids: Record<string, string> }
  | { ok: false; error: string }
> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 2 || sortedIds.length > MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) {
    return {
      ok: false,
      error: `Entre 2 et ${MEMBER_INTAKE_SHIPMENT_MAX_ITEMS} pièces requises pour séparer.`,
    };
  }

  const shipmentIdsToArchive = await collectMemberIntakeShipmentIdsForGroup(service, sortedIds);
  const { keptShipmentId: keptMergedShipmentId, keeperItemId } = await resolveMemberIntakeSplitKeeper(
    service,
    sortedIds,
    shipmentIdsToArchive,
  );
  const secondaryIds = sortedIds.filter((id) => id !== keeperItemId);

  for (const sid of shipmentIdsToArchive) {
    if (keptMergedShipmentId && sid === keptMergedShipmentId) continue;
    const archived = await archiveMemberIntakeShipment(service, sid);
    if (!archived.ok) {
      console.warn("[splitMemberIntakeShippingGroup] archive shipment", sid, archived.error);
      return { ok: false, error: archived.error };
    }
  }

  const splitPortalRemoveKeys = [
    SC_MEMBER_INTAKE_SHIPMENT_ID,
    "sc_merge_item_ids",
    "sc_return_portal_url",
    "sc_return_portal_identifier",
    "sc_return_portal_postal_code",
    "sc_order_number",
    "reference_expedition",
    "sc_dummy_shipment_id",
    "sc_outgoing_parcel_id",
    "sc_dummy_cancel_after_at",
    "sc_dummy_shipment_cancelled_at",
    "numero_suivi",
    "lien_suivi",
    "label_url",
  ] as const;

  for (const id of secondaryIds) {
    await clearItemIntakeShippingLabelMetadata(service, id);
    await patchItemIntakeSendcloudMetadata(
      service,
      id,
      {},
      { removeKeys: [...splitPortalRemoveKeys] },
    );
  }

  const { data: member, error: memErr } = await service
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", params.userId)
    .maybeSingle();
  if (memErr || !member) {
    return { ok: false, error: "Profil membre introuvable." };
  }

  const recipient = memberAsRecipientForConsolidation(
    member as Parameters<typeof memberAsRecipientForConsolidation>[0],
  );
  if ("error" in recipient) {
    return { ok: false, error: recipient.error };
  }

  const now = new Date().toISOString();
  const notes =
    "Séparation intake : bordereau existant conservé sur la pièce qui a déjà un suivi, envoi solo par pièce restante.".slice(
      0,
      2000,
    );
  const itemShipmentIds: Record<string, string> = {};

  if (keptMergedShipmentId) {
    const syncedPrimary = await syncMemberIntakeShipmentItemIntakeLink(service, keptMergedShipmentId, [
      keeperItemId,
    ]);
    if (!syncedPrimary.ok) {
      return { ok: false, error: syncedPrimary.error };
    }
    await patchMemberIntakeDestinationIntakeItemIds(service, keptMergedShipmentId, [keeperItemId]);
    itemShipmentIds[keeperItemId] = keptMergedShipmentId;
    const keeperPatched = await patchItemIntakeSendcloudMetadata(
      service,
      keeperItemId,
      {
        [SC_MEMBER_INTAKE_SHIPMENT_ID]: keptMergedShipmentId,
        [SC_SHIPPING_PREFER_SOLO]: "1",
        notes_interne: notes,
        last_backoffice_update_at: now,
      },
      { removeKeys: ["sc_merge_item_ids"] },
    );
    if (!keeperPatched.ok) {
      return { ok: false, error: keeperPatched.message };
    }

    const { data: keptShipRow } = await service
      .from("shipments")
      .select("tracking_number, member_tracking_url")
      .eq("id", keptMergedShipmentId)
      .maybeSingle();
    const keptTn =
      typeof keptShipRow?.tracking_number === "string" ? keptShipRow.tracking_number.trim() : "";
    if (isIntakeMemberReturnTrackingNumber(keptTn)) {
      const keptUrl =
        typeof keptShipRow?.member_tracking_url === "string" && keptShipRow.member_tracking_url.trim()
          ? keptShipRow.member_tracking_url.trim()
          : buildCarrierTrackingUrlFromNumber(keptTn);
      const destMeta = await readMemberIntakeDestinationMetadata(service, keptMergedShipmentId);
      const destOrder = String(destMeta.sendcloud_order_number ?? "").trim();
      await patchItemIntakeSendcloudMetadata(service, keeperItemId, {
        numero_suivi: keptTn,
        ...(keptUrl ? { lien_suivi: keptUrl } : {}),
        ...(destOrder ? { sc_order_number: destOrder, reference_expedition: destOrder } : {}),
      });
    }
  }

  for (const itemId of keptMergedShipmentId ? secondaryIds : sortedIds) {
    const soloOrderNumber = buildStableMemberIntakeOrderNumber([itemId]);
    const ensured = await ensureMemberIntakeShipmentForPortal(service, {
      ownerUserId: params.userId,
      itemIds: [itemId],
      orderNumber: soloOrderNumber,
      recipient,
      forceCreate: true,
      excludeShipmentIds: keptMergedShipmentId ? [keptMergedShipmentId] : [],
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error };
    }

    await prepareMemberIntakeSoloSplitShipment(service, ensured.shipmentId);

    itemShipmentIds[itemId] = ensured.shipmentId;

    const patched = await patchItemIntakeSendcloudMetadata(
      service,
      itemId,
      {
        [SC_MEMBER_INTAKE_SHIPMENT_ID]: ensured.shipmentId,
        [SC_SHIPPING_PREFER_SOLO]: "1",
        notes_interne: notes,
        last_backoffice_update_at: now,
      },
      { removeKeys: ["sc_merge_item_ids"] },
    );
    if (!patched.ok) {
      return { ok: false, error: patched.message };
    }
  }

  return {
    ok: true,
    primary_item_id: keeperItemId,
    item_shipment_ids: itemShipmentIds,
  };
}
