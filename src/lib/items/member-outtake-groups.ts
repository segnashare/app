import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INTAKE_GROUP_MAX_ITEMS,
  type IntakeGroupItem,
  type IntakeGroupSnapshot,
} from "@/lib/items/member-intake-groups.shared";
import {
  ensureMemberOuttakeShipmentForTransfer,
  syncMemberOuttakeShipmentDestination,
} from "@/lib/items/member-outtake-shipment";
import { resolveTransferShipmentContext } from "@/lib/items/resolve-transfer-shipment-context";
import { loadActiveTransferItemIds } from "@/lib/items/member-transfer-items";

export { INTAKE_GROUP_MAX_ITEMS as OUTTAKE_GROUP_MAX_ITEMS } from "@/lib/items/member-intake-groups.shared";
export type { IntakeGroupItem as OuttakeGroupItem, IntakeGroupSnapshot as OuttakeGroupSnapshot } from "@/lib/items/member-intake-groups.shared";

function computeBalancedOuttakeBucketSizes(totalCount: number): number[] {
  if (totalCount <= 0) return [];
  if (totalCount <= INTAKE_GROUP_MAX_ITEMS) return [totalCount];
  const numBuckets = Math.ceil(totalCount / INTAKE_GROUP_MAX_ITEMS);
  const baseSize = Math.floor(totalCount / numBuckets);
  const remainder = totalCount % numBuckets;
  const sizes: number[] = [];
  for (let i = 0; i < numBuckets; i++) {
    sizes.push(baseSize + (i < remainder ? 1 : 0));
  }
  return sizes;
}

const OUTTAKE_OPEN_STAGES = new Set(["return_open"]);

function outtakeRowEligibleForAutoGroup(row: {
  stage?: string | null;
  item_status?: string | null;
}): boolean {
  const stage = String(row.stage ?? "").trim().toLowerCase();
  const status = String(row.item_status ?? "").trim().toLowerCase();
  return OUTTAKE_OPEN_STAGES.has(stage) && status === "retired";
}

async function findActiveTransferIdForItem(
  service: SupabaseClient,
  itemId: string,
): Promise<string | null> {
  const { data: link } = await service
    .from("transfer_items")
    .select("transfer_id")
    .eq("item_id", itemId.trim())
    .is("deleted_at", null)
    .maybeSingle();

  const transferId = link?.transfer_id ? String(link.transfer_id) : null;
  if (!transferId) return null;

  const { data: transfer } = await service
    .from("transfers")
    .select("id")
    .eq("id", transferId)
    .is("deleted_at", null)
    .is("completed_at", null)
    .maybeSingle();

  return transfer?.id ? transferId : null;
}

async function loadOuttakeGroupItems(
  service: SupabaseClient,
  transferId: string,
): Promise<IntakeGroupItem[]> {
  const itemIds = await loadActiveTransferItemIds(service, transferId);
  if (itemIds.length === 0) return [];

  const { data: itemRows } = await service
    .from("items")
    .select("id, title")
    .in("id", itemIds)
    .is("deleted_at", null);

  const titleById = new Map<string, string>();
  for (const row of itemRows ?? []) {
    titleById.set(String((row as { id?: string }).id ?? ""), String((row as { title?: string }).title ?? "Pièce"));
  }

  const { data: links } = await service
    .from("transfer_items")
    .select("item_id, sort_order")
    .eq("transfer_id", transferId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  return (links ?? []).map((l) => ({
    id: String((l as { item_id?: string }).item_id ?? ""),
    title: titleById.get(String((l as { item_id?: string }).item_id ?? "")) ?? "Pièce",
    sortOrder: typeof (l as { sort_order?: number }).sort_order === "number" ? (l as { sort_order: number }).sort_order : 0,
  }));
}

async function findOuttakeShipmentForTransfer(
  service: SupabaseClient,
  transferId: string,
): Promise<{ id: string; status: string; trackingNumber: string | null } | null> {
  const { data } = await service
    .from("shipments")
    .select("id, status, tracking_number")
    .eq("transfer_id", transferId)
    .eq("context", "member_outtake")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.id) return null;
  return {
    id: String(data.id),
    status: String(data.status ?? "pending"),
    trackingNumber:
      typeof data.tracking_number === "string" && data.tracking_number.trim()
        ? data.tracking_number.trim()
        : null,
  };
}

async function createOuttakeGroup(
  service: SupabaseClient,
  userId: string,
  itemIds: string[],
): Promise<{ ok: true; transferId: string } | { ok: false; error: string }> {
  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))];
  if (sorted.length === 0) return { ok: false, error: "Aucune pièce." };
  if (sorted.length > INTAKE_GROUP_MAX_ITEMS) {
    return { ok: false, error: `Maximum ${INTAKE_GROUP_MAX_ITEMS} pièces par colis.` };
  }

  const { data: transfer, error: transferErr } = await service
    .from("transfers")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (transferErr || !transfer?.id) {
    return { ok: false, error: transferErr?.message ?? "Création colis impossible." };
  }

  const transferId = String(transfer.id);
  const rows = sorted.map((itemId, index) => ({
    transfer_id: transferId,
    item_id: itemId,
    sort_order: index,
  }));

  const { error: itemsErr } = await service.from("transfer_items").insert(rows);
  if (itemsErr) {
    await service.from("transfers").update({ deleted_at: new Date().toISOString() }).eq("id", transferId);
    return { ok: false, error: itemsErr.message };
  }

  return { ok: true, transferId };
}

async function detachItemFromTransfer(
  service: SupabaseClient,
  transferId: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await service
    .from("transfer_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("transfer_id", transferId.trim())
    .eq("item_id", itemId.trim())
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function attachItemToTransfer(
  service: SupabaseClient,
  transferId: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = transferId.trim();
  const iid = itemId.trim();

  const { data: activeElsewhere } = await service
    .from("transfer_items")
    .select("id, transfer_id")
    .eq("item_id", iid)
    .is("deleted_at", null)
    .maybeSingle();

  if (activeElsewhere?.id && String(activeElsewhere.transfer_id) !== tid) {
    return { ok: false, error: "Cette pièce est déjà dans un autre colis." };
  }

  const { count } = await service
    .from("transfer_items")
    .select("id", { count: "exact", head: true })
    .eq("transfer_id", tid)
    .is("deleted_at", null)
    .neq("item_id", iid);

  if ((count ?? 0) >= INTAKE_GROUP_MAX_ITEMS) {
    return { ok: false, error: `Un colis peut contenir au maximum ${INTAKE_GROUP_MAX_ITEMS} pièces.` };
  }

  const { data: existingInTarget } = await service
    .from("transfer_items")
    .select("id")
    .eq("transfer_id", tid)
    .eq("item_id", iid)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingInTarget?.id) return { ok: true };

  const { error } = await service.from("transfer_items").insert({
    transfer_id: tid,
    item_id: iid,
    sort_order: count ?? 0,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function isOpenOuttakeShipmentStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "pending").trim().toLowerCase();
  return s === "pending" || s === "ready";
}

async function transferAcceptsNewOuttakeItems(
  service: SupabaseClient,
  transferId: string,
): Promise<boolean> {
  const ctx = await resolveTransferShipmentContext(service, transferId);
  if (ctx === "member_intake") return false;

  const shipment = await findOuttakeShipmentForTransfer(service, transferId);
  if (!shipment) return true;
  return isOpenOuttakeShipmentStatus(shipment.status);
}

type OpenTransferSlot = {
  transferId: string;
  itemCount: number;
  createdAt: string;
};

async function listOpenOuttakeTransfersForAutoAssign(
  service: SupabaseClient,
  userId: string,
): Promise<OpenTransferSlot[]> {
  const { data: transfers } = await service
    .from("transfers")
    .select("id, created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("completed_at", null)
    .order("created_at", { ascending: true });

  const open: OpenTransferSlot[] = [];
  for (const row of transfers ?? []) {
    const transferId = String(row.id);
    const ctx = await resolveTransferShipmentContext(service, transferId);
    if (ctx === "member_intake") continue;
    if (!(await transferAcceptsNewOuttakeItems(service, transferId))) continue;

    const items = await loadOuttakeGroupItems(service, transferId);
    if (items.length === 0) continue;
    if (items.length >= INTAKE_GROUP_MAX_ITEMS) continue;

    const itemIds = items.map((i) => i.id);
    const { data: outtakeRows } = await service
      .from("item_outtake")
      .select("item_id, stage")
      .in("item_id", itemIds);
    const { data: itemRows } = await service.from("items").select("id, status").in("id", itemIds);

    const statusById = new Map<string, string>();
    for (const r of itemRows ?? []) {
      statusById.set(String((r as { id?: string }).id ?? ""), String((r as { status?: string }).status ?? ""));
    }
    const stageById = new Map<string, string>();
    for (const r of outtakeRows ?? []) {
      stageById.set(String((r as { item_id?: string }).item_id ?? ""), String((r as { stage?: string }).stage ?? ""));
    }

    const allEligible = itemIds.every((id) =>
      outtakeRowEligibleForAutoGroup({
        stage: stageById.get(id),
        item_status: statusById.get(id),
      }),
    );
    if (!allEligible) continue;

    open.push({
      transferId,
      itemCount: items.length,
      createdAt: String(row.created_at ?? ""),
    });
  }

  open.sort((a, b) => {
    if (b.itemCount !== a.itemCount) return b.itemCount - a.itemCount;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return open;
}

async function archiveEmptyOuttakeTransfer(
  service: SupabaseClient,
  transferId: string,
): Promise<void> {
  const { count } = await service
    .from("transfer_items")
    .select("id", { count: "exact", head: true })
    .eq("transfer_id", transferId)
    .is("deleted_at", null);

  if ((count ?? 0) > 0) return;

  const shipment = await findOuttakeShipmentForTransfer(service, transferId);
  if (shipment) {
    await service.from("shipments").update({ deleted_at: new Date().toISOString() }).eq("id", shipment.id);
  }

  await service
    .from("transfers")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", transferId)
    .is("deleted_at", null);
}

async function reconcileOuttakeTransferShipment(
  service: SupabaseClient,
  userId: string,
  transferId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const items = await loadOuttakeGroupItems(service, transferId);
  const itemIds = items.map((i) => i.id);
  if (itemIds.length === 0) return { ok: false, error: "Aucune pièce." };

  const ensured = await ensureMemberOuttakeShipmentForTransfer(service, {
    ownerUserId: userId,
    transferId,
    itemIds,
  });
  if (!ensured.ok) return ensured;

  await syncMemberOuttakeShipmentDestination(service, ensured.shipmentId, itemIds);
  return { ok: true };
}

export async function ensureAutoOuttakeGroupsForUser(
  service: SupabaseClient,
  userId: string,
): Promise<{ ok: true; groups: IntakeGroupSnapshot[] } | { ok: false; error: string }> {
  const { data: rows, error } = await service
    .from("items")
    .select("id, status, item_outtake(stage)")
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .limit(200);

  if (error) return { ok: false, error: error.message };

  const eligibleIds: string[] = [];
  for (const row of rows ?? []) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id) continue;
    const emb = (row as { item_outtake?: unknown }).item_outtake;
    const outtake = Array.isArray(emb) ? emb[0] : emb;
    const stage =
      outtake && typeof outtake === "object"
        ? String((outtake as { stage?: string }).stage ?? "")
        : "";
    const status = String((row as { status?: string }).status ?? "");
    if (!outtakeRowEligibleForAutoGroup({ stage, item_status: status })) continue;
    eligibleIds.push(id);
  }

  const sortedEligible = [...new Set(eligibleIds)].sort((a, b) => a.localeCompare(b));
  const unassigned: string[] = [];
  for (const itemId of sortedEligible) {
    const transferId = await findActiveTransferIdForItem(service, itemId);
    if (!transferId) {
      unassigned.push(itemId);
      continue;
    }
    const ctx = await resolveTransferShipmentContext(service, transferId);
    if (ctx === "member_intake") {
      unassigned.push(itemId);
    }
  }

  if (unassigned.length > 0) {
    const openTransfers = await listOpenOuttakeTransfersForAutoAssign(service, userId);
    const stillUnassigned: string[] = [];
    const touched = new Set<string>();

    for (const itemId of unassigned) {
      const existingTransfer = await findActiveTransferIdForItem(service, itemId);
      if (existingTransfer) {
        const ctx = await resolveTransferShipmentContext(service, existingTransfer);
        if (ctx !== "member_intake") {
          continue;
        }
        await detachItemFromTransfer(service, existingTransfer, itemId);
      }

      const target = openTransfers.find((t) => t.itemCount < INTAKE_GROUP_MAX_ITEMS);
      if (!target) {
        stillUnassigned.push(itemId);
        continue;
      }

      const attached = await attachItemToTransfer(service, target.transferId, itemId);
      if (!attached.ok) {
        stillUnassigned.push(itemId);
        continue;
      }
      target.itemCount += 1;
      touched.add(target.transferId);
    }

    for (const transferId of touched) {
      const reconciled = await reconcileOuttakeTransferShipment(service, userId, transferId);
      if (!reconciled.ok) return reconciled;
    }

    if (stillUnassigned.length > 0) {
      const bucketSizes = computeBalancedOuttakeBucketSizes(stillUnassigned.length);
      let offset = 0;
      for (const size of bucketSizes) {
        const chunk = stillUnassigned.slice(offset, offset + size);
        offset += size;
        if (chunk.length === 0) continue;

        const created = await createOuttakeGroup(service, userId, chunk);
        if (!created.ok) return created;

        const reconciled = await reconcileOuttakeTransferShipment(service, userId, created.transferId);
        if (!reconciled.ok) return reconciled;
      }
    }
  }

  const groups = await fetchOuttakeGroupsForShipping(service, userId);
  return { ok: true, groups };
}

export async function fetchOuttakeGroupsForShipping(
  service: SupabaseClient,
  userId: string,
): Promise<IntakeGroupSnapshot[]> {
  const { data: transfers } = await service
    .from("transfers")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("completed_at", null)
    .order("created_at", { ascending: true });

  const groups: IntakeGroupSnapshot[] = [];
  for (const transfer of transfers ?? []) {
    const transferId = String(transfer.id);
    const ctx = await resolveTransferShipmentContext(service, transferId);
    if (ctx === "member_intake") continue;

    const items = await loadOuttakeGroupItems(service, transferId);
    if (items.length === 0) {
      await archiveEmptyOuttakeTransfer(service, transferId);
      continue;
    }

    const itemIds = items.map((i) => i.id);
    const { data: outtakeRows } = await service
      .from("item_outtake")
      .select("item_id, stage, metadata")
      .in("item_id", itemIds);
    const { data: itemRows } = await service.from("items").select("id, status").in("id", itemIds);

    const statusById = new Map<string, string>();
    for (const r of itemRows ?? []) {
      statusById.set(String((r as { id?: string }).id ?? ""), String((r as { status?: string }).status ?? ""));
    }
    const stageById = new Map<string, string>();
    for (const r of outtakeRows ?? []) {
      stageById.set(String((r as { item_id?: string }).item_id ?? ""), String((r as { stage?: string }).stage ?? ""));
    }

    const eligibleItems = items.filter((item) =>
      outtakeRowEligibleForAutoGroup({
        stage: stageById.get(item.id),
        item_status: statusById.get(item.id),
      }),
    );
    if (eligibleItems.length === 0) continue;

    const shipment = await findOuttakeShipmentForTransfer(service, transferId);
    let labelUrl: string | null = null;
    let trackingNumber: string | null = shipment?.trackingNumber ?? null;
    for (const r of outtakeRows ?? []) {
      const meta = (r as { metadata?: unknown }).metadata;
      if (meta == null || typeof meta !== "object" || Array.isArray(meta)) continue;
      const m = meta as Record<string, unknown>;
      if (!labelUrl && typeof m.return_label_url === "string" && m.return_label_url.trim()) {
        labelUrl = m.return_label_url.trim();
      }
      if (!trackingNumber && typeof m.return_tracking_number === "string" && m.return_tracking_number.trim()) {
        trackingNumber = m.return_tracking_number.trim();
      }
    }
    const hasActiveLabel = Boolean(trackingNumber || labelUrl);

    groups.push({
      id: transferId,
      items: eligibleItems,
      shipmentId: shipment?.id ?? null,
      shipmentStatus: shipment?.status ?? null,
      hasActiveLabel,
      labelUrl,
      trackingNumber,
    });
  }

  return groups;
}

export async function moveItemToOuttakeGroup(
  service: SupabaseClient,
  params: {
    userId: string;
    itemId: string;
    targetTransferId: string | null;
  },
): Promise<{ ok: true; groups: IntakeGroupSnapshot[] } | { ok: false; error: string }> {
  const itemId = params.itemId.trim();
  const userId = params.userId.trim();
  if (!itemId) return { ok: false, error: "Pièce manquante." };

  const sourceTransferId = await findActiveTransferIdForItem(service, itemId);
  let targetTransferId = params.targetTransferId?.trim() ?? null;

  if (targetTransferId) {
    const ctx = await resolveTransferShipmentContext(service, targetTransferId);
    if (ctx === "member_intake") {
      return { ok: false, error: "Ce colis est réservé à un envoi vers Segna." };
    }
    if (!(await transferAcceptsNewOuttakeItems(service, targetTransferId))) {
      return { ok: false, error: "Ce colis n'accepte plus de modification." };
    }
  }

  if (sourceTransferId && targetTransferId && sourceTransferId === targetTransferId) {
    const groups = await fetchOuttakeGroupsForShipping(service, userId);
    return { ok: true, groups };
  }

  if (sourceTransferId) {
    const detached = await detachItemFromTransfer(service, sourceTransferId, itemId);
    if (!detached.ok) return detached;
  }

  if (!targetTransferId) {
    const created = await createOuttakeGroup(service, userId, [itemId]);
    if (!created.ok) return created;
    targetTransferId = created.transferId;
  } else {
    const attached = await attachItemToTransfer(service, targetTransferId, itemId);
    if (!attached.ok) return attached;
  }

  const reconciledTarget = await reconcileOuttakeTransferShipment(service, userId, targetTransferId!);
  if (!reconciledTarget.ok) return reconciledTarget;

  if (sourceTransferId) {
    const remaining = await loadOuttakeGroupItems(service, sourceTransferId);
    if (remaining.length === 0) {
      await archiveEmptyOuttakeTransfer(service, sourceTransferId);
    } else {
      const reconciledSource = await reconcileOuttakeTransferShipment(service, userId, sourceTransferId);
      if (!reconciledSource.ok) return reconciledSource;
    }
  }

  const groups = await fetchOuttakeGroupsForShipping(service, userId);
  return { ok: true, groups };
}

/** Transfer outtake actif contenant la pièce (hors intake). */
export async function resolveOuttakeTransferIdForItem(
  service: SupabaseClient,
  itemId: string,
): Promise<string | null> {
  const transferId = await findActiveTransferIdForItem(service, itemId);
  if (!transferId) return null;
  const ctx = await resolveTransferShipmentContext(service, transferId);
  if (ctx === "member_intake") return null;
  return transferId;
}

export async function buildOuttakeTransferIdByItemId(
  service: SupabaseClient,
  _ownerUserId: string,
  itemIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(
    unique.map(async (itemId) => {
      const transferId = await resolveOuttakeTransferIdForItem(service, itemId);
      if (transferId) out[itemId] = transferId;
    }),
  );
  return out;
}

/** Après demande de retour : rattache la pièce à un colis outtake (auto-groupement membre). */
export async function assignOuttakeItemAfterRequest(
  service: SupabaseClient,
  userId: string,
  itemId: string,
): Promise<{ ok: true; transferId: string | null } | { ok: false; error: string }> {
  const ensured = await ensureAutoOuttakeGroupsForUser(service, userId);
  if (!ensured.ok) return ensured;

  const transferId = await findActiveTransferIdForItem(service, itemId);
  return { ok: true, transferId };
}
