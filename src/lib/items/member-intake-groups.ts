import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INTAKE_GROUP_MAX_ITEMS,
  type IntakeGroupItem,
  type IntakeGroupSnapshot,
} from "@/lib/items/member-intake-groups.shared";
import { isIntakeMemberReturnTrackingNumber } from "@/lib/items/intake-shipping-metadata";
import {
  clearItemIntakeShippingLabelMetadata,
  patchItemIntakeSendcloudMetadata,
} from "@/lib/items/item-intake-sendcloud-patch";
import { reverseLendIntakeVerifiedCreditIfPosted } from "@/lib/wallet/reverse-lend-intake-verified-credit";
import {
  intakeEligibleForPiggybackLink,
  INTAKE_FULFILLMENT_READY,
} from "@/lib/items/intake-fulfillment-stages";
import { resolveTransferShipmentContext } from "@/lib/items/resolve-transfer-shipment-context";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";
import type { SendcloudOutboundRecipient } from "@/lib/sendcloud/shipments";

const SC_MEMBER_INTAKE_SHIPMENT_ID = "sc_member_intake_shipment_id";

/** Import dynamique : évite le cycle member-intake-shipment ↔ resolve-member-intake-item-ids. */
async function loadMemberIntakeShipmentLib() {
  return import("@/lib/items/member-intake-shipment");
}

/** Répartit N pièces en enveloppes équilibrées (max 5 par enveloppe). */
export function computeBalancedIntakeBucketSizes(totalCount: number): number[] {
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

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isIntakeCartReturnPiggybackActive(metadata: unknown): boolean {
  if (!isPlainRecord(metadata)) return false;
  const sc = metadata.sendcloud;
  if (!isPlainRecord(sc)) return false;
  const mode = typeof sc.sc_shipping_mode === "string" ? sc.sc_shipping_mode.trim() : "";
  if (mode !== "cart_return_piggyback") return false;
  const cartId = typeof sc.sc_piggyback_cart_id === "string" ? sc.sc_piggyback_cart_id.trim() : "";
  const confirmedAt =
    typeof sc.sc_piggyback_confirmed_at === "string" ? sc.sc_piggyback_confirmed_at.trim() : "";
  return Boolean(cartId && confirmedAt);
}

function intakeRowEligibleForAutoGroup(intake: {
  listing_stage?: string;
  fulfillment_stage?: string | null;
  metadata?: unknown;
}): boolean {
  const ls = String(intake.listing_stage ?? "").toLowerCase();
  const fs = String(intake.fulfillment_stage ?? "").toLowerCase();
  if (ls !== "validated") return false;
  if (!intakeEligibleForPiggybackLink(fs) && fs !== INTAKE_FULFILLMENT_READY) return false;
  if (isIntakeCartReturnPiggybackActive(intake.metadata)) return false;
  return true;
}

async function memberAsRecipient(
  service: SupabaseClient,
  userId: string,
): Promise<SendcloudOutboundRecipient | { error: string }> {
  const { data: member, error } = await service
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", userId)
    .maybeSingle();
  if (error || !member) return { error: "Profil membre introuvable." };

  const fn = member.first_name?.trim() ?? "";
  const ln = member.last_name?.trim() ?? "";
  const email = member.email?.trim() ?? "";
  const phone = String(member.phone ?? "").replace(/\s/g, "").trim();
  const parsed = parseMemberAdressForShipment(member.adress);
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
    const staleTransferId = String(activeElsewhere.transfer_id);
    const { data: staleTransfer } = await service
      .from("transfers")
      .select("id")
      .eq("id", staleTransferId)
      .is("deleted_at", null)
      .is("completed_at", null)
      .maybeSingle();

    if (!staleTransfer?.id) {
      const { error: detachErr } = await service
        .from("transfer_items")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", activeElsewhere.id)
        .is("deleted_at", null);
      if (detachErr) return { ok: false, error: detachErr.message };
    } else {
      return {
        ok: false,
        error: "Cette pièce est encore rattachée à un autre envoi. Réessaie dans un instant.",
      };
    }
  }

  const { data: existingInTarget } = await service
    .from("transfer_items")
    .select("id")
    .eq("transfer_id", tid)
    .eq("item_id", iid)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingInTarget?.id) return { ok: true };

  const { count } = await service
    .from("transfer_items")
    .select("id", { count: "exact", head: true })
    .eq("transfer_id", tid)
    .is("deleted_at", null);

  const { error } = await service.from("transfer_items").insert({
    transfer_id: tid,
    item_id: iid,
    sort_order: count ?? 0,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function loadIntakeGroupItems(
  service: SupabaseClient,
  transferId: string,
): Promise<IntakeGroupItem[]> {
  const { data: links, error: linkErr } = await service
    .from("transfer_items")
    .select("item_id, sort_order")
    .eq("transfer_id", transferId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (linkErr || !links?.length) return [];

  const itemIds = links.map((l) => String(l.item_id));
  const { data: items } = await service
    .from("items")
    .select("id, title")
    .in("id", itemIds)
    .is("deleted_at", null);

  const titleById = new Map<string, string>();
  for (const row of items ?? []) {
    const id = String(row.id);
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Pièce";
    titleById.set(id, title);
  }

  return links.map((l) => ({
    id: String(l.item_id),
    title: titleById.get(String(l.item_id)) ?? "Pièce",
    sortOrder: typeof l.sort_order === "number" ? l.sort_order : 0,
  }));
}

async function findShipmentForTransfer(
  service: SupabaseClient,
  transferId: string,
): Promise<{ id: string; status: string; trackingNumber: string | null } | null> {
  const { data } = await service
    .from("shipments")
    .select("id, status, tracking_number")
    .eq("transfer_id", transferId)
    .eq("context", "member_intake")
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

async function createIntakeGroup(
  service: SupabaseClient,
  userId: string,
  itemIds: string[],
): Promise<{ ok: true; transferId: string } | { ok: false; error: string }> {
  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))];
  if (sorted.length === 0) return { ok: false, error: "Aucune pièce." };
  if (sorted.length > INTAKE_GROUP_MAX_ITEMS) {
    return { ok: false, error: `Maximum ${INTAKE_GROUP_MAX_ITEMS} pièces par envoi.` };
  }

  const { data: transfer, error: transferErr } = await service
    .from("transfers")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (transferErr || !transfer?.id) {
    return { ok: false, error: transferErr?.message ?? "Création envoi impossible." };
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

async function ensureShipmentForIntakeGroup(
  service: SupabaseClient,
  userId: string,
  transferId: string,
  itemIds: string[],
): Promise<{ ok: true; shipmentId: string } | { ok: false; error: string }> {
  const existing = await findShipmentForTransfer(service, transferId);
  if (existing) return { ok: true, shipmentId: existing.id };

  const recipient = await memberAsRecipient(service, userId);
  if ("error" in recipient) return { ok: false, error: recipient.error };

  const sorted = [...itemIds].sort();
  const { buildStableMemberIntakeOrderNumber, ensureMemberIntakeShipmentForPortal } =
    await loadMemberIntakeShipmentLib();
  const orderNumber = buildStableMemberIntakeOrderNumber(sorted);
  const ensured = await ensureMemberIntakeShipmentForPortal(service, {
    ownerUserId: userId,
    itemIds: sorted,
    orderNumber,
    recipient,
    existingTransferId: transferId,
  });
  if (!ensured.ok) return { ok: false, error: ensured.error };

  return { ok: true, shipmentId: ensured.shipmentId };
}

async function archiveEmptyTransferGroup(
  service: SupabaseClient,
  transferId: string,
): Promise<void> {
  const { count } = await service
    .from("transfer_items")
    .select("id", { count: "exact", head: true })
    .eq("transfer_id", transferId)
    .is("deleted_at", null);

  if ((count ?? 0) > 0) return;

  const shipment = await findShipmentForTransfer(service, transferId);
  if (shipment) {
    const { archiveMemberIntakeShipment } = await loadMemberIntakeShipmentLib();
    await archiveMemberIntakeShipment(service, shipment.id);
  }

  await service
    .from("transfers")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", transferId)
    .is("deleted_at", null);
}

type OpenTransferSlot = {
  transferId: string;
  itemCount: number;
  createdAt: string;
};

function normalizeTransferId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function isUndepositedMemberIntakeShipmentStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "pending").trim().toLowerCase();
  return s === "pending" || s === "ready";
}

async function transferAcceptsNewIntakeItems(
  service: SupabaseClient,
  transferId: string,
): Promise<boolean> {
  const shipment = await findShipmentForTransfer(service, transferId);
  if (!shipment) return true;
  return isUndepositedMemberIntakeShipmentStatus(shipment.status);
}

/** Enveloppes actives non déposées au relais, avec de la place (< 5 pièces). */
async function listUndepositedTransfersForAutoAssign(
  service: SupabaseClient,
  userId: string,
  excludeTransferId?: string,
): Promise<OpenTransferSlot[]> {
  const exclude = normalizeTransferId(excludeTransferId);
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
    if (exclude && normalizeTransferId(transferId) === exclude) continue;

    const ctx = await resolveTransferShipmentContext(service, transferId);
    if (ctx === "member_outtake") continue;

    const items = await loadIntakeGroupItems(service, transferId);
    if (items.length >= INTAKE_GROUP_MAX_ITEMS) continue;

    if (!(await transferAcceptsNewIntakeItems(service, transferId))) continue;

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

/** Réaffecte des pièces vers un transfer pas encore déposé (ou en crée un). */
export async function reassignItemsToUndepositedTransfers(
  service: SupabaseClient,
  params: {
    userId: string;
    itemIds: string[];
    excludeTransferId?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = params.userId.trim();
  const sorted = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sorted.length === 0) return { ok: true };

  const exclude = normalizeTransferId(params.excludeTransferId);
  const openTransfers = await listUndepositedTransfersForAutoAssign(
    service,
    userId,
    params.excludeTransferId,
  );
  const stillUnassigned: string[] = [];
  const touchedTransferIds = new Set<string>();

  for (const itemId of sorted) {
    const target = openTransfers.find(
      (t) =>
        t.itemCount < INTAKE_GROUP_MAX_ITEMS &&
        (!exclude || normalizeTransferId(t.transferId) !== exclude),
    );
    if (!target) {
      stillUnassigned.push(itemId);
      continue;
    }

    if (!(await transferAcceptsNewIntakeItems(service, target.transferId))) {
      stillUnassigned.push(itemId);
      continue;
    }

    const attached = await attachItemToTransfer(service, target.transferId, itemId);
    if (!attached.ok) {
      stillUnassigned.push(itemId);
      continue;
    }

    target.itemCount += 1;
    touchedTransferIds.add(target.transferId);
  }

  if (stillUnassigned.length > 0) {
    const bucketSizes = computeBalancedIntakeBucketSizes(stillUnassigned.length);
    let offset = 0;
    for (const size of bucketSizes) {
      const chunk = stillUnassigned.slice(offset, offset + size);
      offset += size;
      if (chunk.length === 0) continue;

      const created = await createIntakeGroup(service, userId, chunk);
      if (!created.ok) return { ok: false, error: created.error };
      touchedTransferIds.add(created.transferId);
    }
  }

  for (const transferId of touchedTransferIds) {
    const reconciled = await reconcileTransferGroupShipment(service, userId, transferId);
    if (!reconciled.ok) return reconciled;
  }

  for (const itemId of sorted) {
    try {
      await reverseLendIntakeVerifiedCreditIfPosted(service, itemId, "member_intake_transfer_reassign");
    } catch {
      /* RPC absente en local : ignorer */
    }
    await clearItemIntakeShippingLabelMetadata(service, itemId);
    await service.from("item_intake").update({ fulfillment_stage: null }).eq("item_id", itemId);
  }

  return { ok: true };
}

/** Enveloppes actives avec de la place (< 5 pièces), pas encore déposées au relais. */
async function listOpenTransfersForAutoAssign(
  service: SupabaseClient,
  userId: string,
): Promise<OpenTransferSlot[]> {
  return listUndepositedTransfersForAutoAssign(service, userId);
}

async function reconcileTransferGroupShipment(
  service: SupabaseClient,
  userId: string,
  transferId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const items = await loadIntakeGroupItems(service, transferId);
  const itemIds = items.map((i) => i.id);
  if (itemIds.length === 0) return { ok: false, error: "Aucune pièce." };

  const shipment = await ensureShipmentForIntakeGroup(service, userId, transferId, itemIds);
  if (!shipment.ok) return shipment;

  const recipient = await memberAsRecipient(service, userId);
  if ("error" in recipient) return { ok: false, error: recipient.error };

  const sortedIds = [...itemIds].sort((a, b) => a.localeCompare(b));
  const {
    syncMemberIntakeShipmentItemIntakeLink,
    buildStableMemberIntakeOrderNumber,
    updateMemberIntakeDestinationForPortal,
    parseMemberIntakePortalGeneration,
    readMemberIntakeDestinationMetadata,
  } = await loadMemberIntakeShipmentLib();

  const orderNumber = buildStableMemberIntakeOrderNumber(sortedIds);
  const destMeta = await readMemberIntakeDestinationMetadata(service, shipment.shipmentId);
  const generation = parseMemberIntakePortalGeneration(destMeta);

  await updateMemberIntakeDestinationForPortal(service, shipment.shipmentId, {
    orderNumber,
    itemIds: sortedIds,
    ownerUserId: userId,
    recipient,
    generation,
  });

  const synced = await syncMemberIntakeShipmentItemIntakeLink(service, shipment.shipmentId, sortedIds, {
    mergeWithExistingSlots: false,
    ownerUserId: userId,
  });
  if (!synced.ok) return synced;

  for (const id of sortedIds) {
    await patchItemIntakeSendcloudMetadata(service, id, {
      [SC_MEMBER_INTAKE_SHIPMENT_ID]: shipment.shipmentId,
      sc_order_number: orderNumber,
      reference_expedition: orderNumber,
    });
  }
  return { ok: true };
}

/**
 * Assigne automatiquement les pièces éligibles en enveloppes équilibrées (max 5 / envoi).
 */
export async function ensureAutoIntakeGroupsForUser(
  service: SupabaseClient,
  userId: string,
): Promise<{ ok: true; groups: IntakeGroupSnapshot[] } | { ok: false; error: string }> {
  const { data: rows, error } = await service
    .from("items")
    .select("id, item_intake(listing_stage, fulfillment_stage, metadata)")
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .limit(200);

  if (error) return { ok: false, error: error.message };

  const eligibleIds: string[] = [];
  for (const row of rows ?? []) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id) continue;
    const emb = (row as { item_intake?: unknown }).item_intake;
    const intake = Array.isArray(emb) ? emb[0] : emb;
    if (!intake || typeof intake !== "object") continue;
    if (!intakeRowEligibleForAutoGroup(intake as Parameters<typeof intakeRowEligibleForAutoGroup>[0])) {
      continue;
    }
    eligibleIds.push(id);
  }

  const sortedEligible = [...new Set(eligibleIds)].sort((a, b) => a.localeCompare(b));

  const unassigned: string[] = [];
  for (const itemId of sortedEligible) {
    const transferId = await findActiveTransferIdForItem(service, itemId);
    if (!transferId) unassigned.push(itemId);
  }

  if (unassigned.length > 0) {
    const openTransfers = await listUndepositedTransfersForAutoAssign(service, userId);
    const stillUnassigned: string[] = [];
    const touchedTransferIds = new Set<string>();

    for (const itemId of unassigned) {
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
      touchedTransferIds.add(target.transferId);
    }

    for (const transferId of touchedTransferIds) {
      const reconciled = await reconcileTransferGroupShipment(service, userId, transferId);
      if (!reconciled.ok) return { ok: false, error: reconciled.error };
    }

    if (stillUnassigned.length > 0) {
      const bucketSizes = computeBalancedIntakeBucketSizes(stillUnassigned.length);
      let offset = 0;
      for (const size of bucketSizes) {
        const chunk = stillUnassigned.slice(offset, offset + size);
        offset += size;
        if (chunk.length === 0) continue;

        const created = await createIntakeGroup(service, userId, chunk);
        if (!created.ok) return { ok: false, error: created.error };

        const reconciled = await reconcileTransferGroupShipment(service, userId, created.transferId);
        if (!reconciled.ok) return { ok: false, error: reconciled.error };
      }
    }
  }

  const { data: allTransfers } = await service
    .from("transfers")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("completed_at", null);

  for (const transfer of allTransfers ?? []) {
    const transferId = String(transfer.id);
    const items = await loadIntakeGroupItems(service, transferId);
    if (items.length === 0) continue;
    const reconciled = await reconcileTransferGroupShipment(service, userId, transferId);
    if (!reconciled.ok) return { ok: false, error: reconciled.error };
  }

  const groups = await fetchIntakeGroupsForShipping(service, userId);
  return { ok: true, groups };
}

export async function fetchIntakeGroupsForShipping(
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
    if (ctx === "member_outtake") continue;

    const items = await loadIntakeGroupItems(service, transferId);
    if (items.length === 0) {
      await archiveEmptyTransferGroup(service, transferId);
      continue;
    }

    const eligibleItems: IntakeGroupItem[] = [];
    const itemIds = items.map((i) => i.id);
    const { data: intakeRows } = await service
      .from("item_intake")
      .select("item_id, listing_stage, fulfillment_stage, metadata")
      .in("item_id", itemIds);

    const intakeByItem = new Map<string, Record<string, unknown>>();
    for (const row of intakeRows ?? []) {
      intakeByItem.set(String(row.item_id), row as Record<string, unknown>);
    }

    for (const item of items) {
      const ii = intakeByItem.get(item.id);
      if (!ii || !intakeRowEligibleForAutoGroup(ii)) continue;
      eligibleItems.push(item);
    }

    if (eligibleItems.length === 0) continue;

    const shipment = await findShipmentForTransfer(service, transferId);
    const hasActiveLabel = Boolean(
      shipment?.trackingNumber && isIntakeMemberReturnTrackingNumber(shipment.trackingNumber),
    );

    groups.push({
      id: transferId,
      items: eligibleItems,
      shipmentId: shipment?.id ?? null,
      shipmentStatus: shipment?.status ?? null,
      hasActiveLabel,
    });
  }

  return groups;
}

export async function moveItemToIntakeGroup(
  service: SupabaseClient,
  params: {
    userId: string;
    itemId: string;
    targetIntakeId: string | null;
  },
): Promise<{ ok: true; groups: IntakeGroupSnapshot[] } | { ok: false; error: string }> {
  const itemId = params.itemId.trim();
  const userId = params.userId.trim();
  if (!itemId) return { ok: false, error: "Pièce manquante." };

  const sourceTransferId = await findActiveTransferIdForItem(service, itemId);

  let targetTransferId = params.targetIntakeId?.trim() ?? null;

  if (targetTransferId) {
    const { data: target } = await service
      .from("transfers")
      .select("id")
      .eq("id", targetTransferId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .is("completed_at", null)
      .maybeSingle();
    if (!target?.id) return { ok: false, error: "Envoi introuvable." };

    const { count } = await service
      .from("transfer_items")
      .select("id", { count: "exact", head: true })
      .eq("transfer_id", targetTransferId)
      .is("deleted_at", null)
      .neq("item_id", itemId);

    if ((count ?? 0) >= INTAKE_GROUP_MAX_ITEMS) {
      return {
        ok: false,
        error: `Un colis peut contenir au maximum ${INTAKE_GROUP_MAX_ITEMS} pièces. Glisse la pièce vers un autre colis ou crée un nouvel envoi.`,
      };
    }
  }

  if (sourceTransferId && targetTransferId && sourceTransferId === targetTransferId) {
    const groups = await fetchIntakeGroupsForShipping(service, userId);
    return { ok: true, groups };
  }

  // Détacher avant tout rattachement (contrainte unique item_id active).
  if (sourceTransferId) {
    const detached = await detachItemFromTransfer(service, sourceTransferId, itemId);
    if (!detached.ok) return { ok: false, error: detached.error };
  }

  if (!targetTransferId) {
    const { data: transfer, error: transferErr } = await service
      .from("transfers")
      .insert({ user_id: userId })
      .select("id")
      .single();
    if (transferErr || !transfer?.id) {
      return { ok: false, error: transferErr?.message ?? "Création envoi impossible." };
    }
    targetTransferId = String(transfer.id);
  }

  const attached = await attachItemToTransfer(service, targetTransferId, itemId);
  if (!attached.ok) return { ok: false, error: attached.error };

  const reconciledTarget = await reconcileTransferGroupShipment(service, userId, targetTransferId!);
  if (!reconciledTarget.ok) return reconciledTarget;

  if (sourceTransferId) {
    const remaining = await loadIntakeGroupItems(service, sourceTransferId);
    if (remaining.length === 0) {
      await archiveEmptyTransferGroup(service, sourceTransferId);
    } else {
      const reconciledSource = await reconcileTransferGroupShipment(service, userId, sourceTransferId);
      if (!reconciledSource.ok) return reconciledSource;
    }
  }

  const groups = await fetchIntakeGroupsForShipping(service, userId);
  return { ok: true, groups };
}

export { INTAKE_GROUP_MAX_ITEMS, type IntakeGroupItem, type IntakeGroupSnapshot } from "@/lib/items/member-intake-groups.shared";
