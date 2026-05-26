import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clearItemIntakeShippingLabelMetadata,
  patchItemIntakeSendcloudMetadata,
} from "@/lib/items/item-intake-sendcloud-patch";
import { getSendcloudEnv, type SendcloudEnv } from "@/lib/sendcloud/config";
import { buildSendcloudV3ParcelLabelUrl } from "@/lib/sendcloud/label-url";
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
  cancelSendcloudReturnsForOrderNumber,
  cancelSendcloudReturnsForTrackingNumbers,
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sid = shipmentId.trim();
  if (!sid) return { ok: false, error: "ID expédition manquant." };

  const nowIso = new Date().toISOString();
  const patch = {
    deleted_at: nowIso,
    tracking_number: null,
    member_tracking_url: null,
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

  const candidates = [...seen];
  if (candidates.length === 0) return [];

  const { data: ships } = await service
    .from("shipments")
    .select("id")
    .in("id", candidates)
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

  await service
    .from("shipment_destinations")
    .update({
      metadata: {
        ...prev,
        sendcloud_parcel_id: pid,
        ...(orderNumber ? { sendcloud_return_order_number: orderNumber } : {}),
        sc_sendcloud_intake_return_parcel_at: new Date().toISOString(),
      },
    })
    .eq("id", dest.id);
}

/** Crée ou réutilise l’expédition DB `member_intake` pour le portail (sans doublon). */
export async function ensureMemberIntakeShipmentForPortal(
  service: SupabaseClient,
  params: {
    ownerUserId: string;
    itemIds: string[];
    orderNumber: string;
    recipient: SendcloudOutboundRecipient;
  },
): Promise<{ ok: true; shipmentId: string; reused: boolean } | { ok: false; error: string }> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1) {
    return { ok: false, error: "Aucune pièce." };
  }

  let shipmentId: string | null = null;

  const { data: intakeRows } = await service
    .from("item_intake")
    .select("item_id, metadata")
    .in("item_id", sortedIds);

  for (const row of intakeRows ?? []) {
    const sid = readScMemberIntakeShipmentId(row.metadata);
    if (!sid) continue;
    const loaded = await loadMemberIntakeShipment(service, sid);
    if (loaded) {
      shipmentId = loaded.id;
      break;
    }
  }

  if (!shipmentId) {
    shipmentId = await findMemberIntakeShipmentByOrderNumber(service, params.orderNumber);
  }

  let reused = Boolean(shipmentId);

  if (!shipmentId) {
    const { data: inserted, error: insErr } = await service
      .from("shipments")
      .insert({ cart_id: null, context: "member_intake", status: "pending" })
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

  await ensureMemberIntakeDestination(service, shipmentId, {
    orderNumber: params.orderNumber,
    itemIds: sortedIds,
    ownerUserId: params.ownerUserId,
    recipient: params.recipient,
  });

  for (const id of sortedIds) {
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
  params: { itemIds: string[] },
): Promise<void> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length === 0) return;

  const shipmentIds = new Set<string>();

  const { data: intakeRows } = await service
    .from("item_intake")
    .select("item_id, metadata")
    .in("item_id", sortedIds);

  for (const row of intakeRows ?? []) {
    const sid = readScMemberIntakeShipmentId(row.metadata);
    if (sid) shipmentIds.add(sid);
  }

  for (const shipmentId of shipmentIds) {
    const loaded = await loadMemberIntakeShipment(service, shipmentId);
    if (!loaded) continue;

    await service
      .from("shipments")
      .update({
        status: "pending",
        tracking_number: null,
        member_tracking_url: null,
        ready_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shipmentId);

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

  const parcels = await findSendcloudParcelsByOrderNumberV3(env, orderNumber);
  const exclude = new Set<number>();
  if (params.dummyParcelId != null && params.dummyParcelId > 0) exclude.add(params.dummyParcelId);
  if (params.outgoingParcelId != null && params.outgoingParcelId > 0) exclude.add(params.outgoingParcelId);

  let chosen: (typeof parcels)[number] | null = null;
  for (const parcel of parcels) {
    const id = typeof parcel.id === "number" ? parcel.id : NaN;
    if (!Number.isFinite(id) || id <= 0 || exclude.has(id)) continue;
    const tn = String(parcel.tracking_number ?? "").trim();
    if (isIntakeMemberReturnTrackingNumber(tn)) {
      chosen = parcel;
      break;
    }
  }

  if (!chosen?.id) {
    return { ok: true, synced: false };
  }

  const parcelId = chosen.id as number;
  const trackingNumber = String(chosen.tracking_number ?? "").trim() || null;
  const labelUrl = buildSendcloudV3ParcelLabelUrl(env, parcelId);

  await patchMemberIntakeShipmentReturnParcel(service, shipmentId, parcelId, { orderNumber });
  await syncMemberIntakeShipmentTracking(service, shipmentId, {
    trackingNumber,
    trackingUrl: labelUrl.startsWith("http") ? labelUrl : null,
  });

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
    const tn = String(snap?.trackingNumber ?? "").trim();
    if (isIntakeMemberReturnTrackingNumber(tn)) return tn;
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
  if (sortedIds.length < 2 || sortedIds.length > 5) {
    return { ok: false, error: "Entre 2 et 5 pièces requises pour regrouper." };
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

  const shipmentIdsToArchive = await collectMemberIntakeShipmentIdsForGroup(service, sortedIds);

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
    const archived = await archiveMemberIntakeShipment(service, sid);
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
      { removeKeys: [SC_SHIPPING_PREFER_SOLO] },
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

/**
 * Séparation d’un lot groupé : annule le retour Sendcloud du groupe, archive le shipment fusionné,
 * crée un `member_intake` par pièce.
 */
export async function splitMemberIntakeShippingGroup(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[] },
): Promise<
  | { ok: true; primary_item_id: string; item_shipment_ids: Record<string, string> }
  | { ok: false; error: string }
> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 2 || sortedIds.length > 5) {
    return { ok: false, error: "Entre 2 et 5 pièces requises pour séparer." };
  }

  const groupOrderNumber = buildStableMemberIntakeOrderNumber(sortedIds);
  const shipmentIdsToArchive = await collectMemberIntakeShipmentIdsForGroup(service, sortedIds);

  const env = getSendcloudEnv();
  if (env) {
    const cancelInput = await loadMemberIntakeGroupCancelInput(service, {
      itemIds: sortedIds,
      groupOrderNumber,
    });
    const cancelled = await cancelMemberIntakeSendcloudArtifacts(env, cancelInput);
    if (!cancelled.ok) {
      // La séparation DB doit passer même si Sendcloud refuse l’annulation (retour déjà déposé, etc.).
      console.warn("[splitMemberIntakeShippingGroup] sendcloud cancel", cancelled.error);
    }
  }

  for (const sid of shipmentIdsToArchive) {
    const archived = await archiveMemberIntakeShipment(service, sid);
    if (!archived.ok) {
      console.warn("[splitMemberIntakeShippingGroup] archive shipment", sid, archived.error);
      return { ok: false, error: archived.error };
    }
  }

  for (const id of sortedIds) {
    await clearItemIntakeShippingLabelMetadata(service, id);
    await patchItemIntakeSendcloudMetadata(
      service,
      id,
      {},
      {
        removeKeys: [
          SC_MEMBER_INTAKE_SHIPMENT_ID,
          "sc_merge_item_ids",
          "sc_return_portal_url",
          "sc_return_portal_identifier",
          "sc_return_portal_postal_code",
        ],
      },
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
    "Séparation intake : expédition groupée archivée, envoi solo par pièce.".slice(0, 2000);
  const itemShipmentIds: Record<string, string> = {};

  for (const itemId of sortedIds) {
    const soloOrderNumber = buildStableMemberIntakeOrderNumber([itemId]);
    const ensured = await ensureMemberIntakeShipmentForPortal(service, {
      ownerUserId: params.userId,
      itemIds: [itemId],
      orderNumber: soloOrderNumber,
      recipient,
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error };
    }

    itemShipmentIds[itemId] = ensured.shipmentId;

    const patchRes = await patchItemIntakeSendcloudMetadata(
      service,
      itemId,
      {
        [SC_MEMBER_INTAKE_SHIPMENT_ID]: ensured.shipmentId,
        sc_order_number: soloOrderNumber,
        reference_expedition: soloOrderNumber,
        [SC_SHIPPING_PREFER_SOLO]: "1",
        notes_interne: notes,
        last_backoffice_update_at: now,
      },
      { removeKeys: ["sc_merge_item_ids"] },
    );
    if (!patchRes.ok) {
      return { ok: false, error: patchRes.message };
    }
  }

  return {
    ok: true,
    primary_item_id: sortedIds[0]!,
    item_shipment_ids: itemShipmentIds,
  };
}
