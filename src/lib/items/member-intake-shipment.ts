import type { SupabaseClient } from "@supabase/supabase-js";

import { patchItemIntakeSendcloudMetadata } from "@/lib/items/item-intake-sendcloud-patch";
import type { SendcloudEnv } from "@/lib/sendcloud/config";
import {
  isIntakeMemberReturnTrackingNumber,
  parseIntakeShippingLabelFromMetadata,
  readMemberIntakeShipmentIdFromMetadata,
} from "@/lib/items/intake-shipping-metadata";
import { cancelSendcloudOutboundParcel } from "@/lib/sendcloud/orders-api";
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
): Promise<void> {
  const sid = shipmentId.trim();
  if (!sid) return;

  const nowIso = new Date().toISOString();
  await service
    .from("shipments")
    .update({
      deleted_at: nowIso,
      tracking_number: null,
      member_tracking_url: null,
      updated_at: nowIso,
    })
    .eq("id", sid)
    .eq("context", "member_intake")
    .is("deleted_at", null);
}

export async function syncMemberIntakeShipmentTracking(
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
    metaPatch.sendcloud_parcel_id = params.outboundParcelId;
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
