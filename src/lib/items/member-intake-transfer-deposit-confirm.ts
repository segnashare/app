import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clearItemIntakeShippingLabelMetadata,
  patchItemIntakeSendcloudMetadata,
} from "@/lib/items/item-intake-sendcloud-patch";
import { reverseLendIntakeVerifiedCreditIfPosted } from "@/lib/wallet/reverse-lend-intake-verified-credit";
import { reassignItemsToUndepositedTransfers } from "@/lib/items/member-intake-groups";
import {
  SC_MEMBER_INTAKE_SHIPMENT_ID,
  syncMemberIntakeShipmentItemIntakeLink,
} from "@/lib/items/member-intake-shipment";
import { loadActiveTransferItemIds } from "@/lib/items/member-transfer-items";
import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";

const DEST_INTAKE_ITEM_IDS = "sc_intake_item_ids";

export const SC_MEMBER_DEPOSIT_CONFIRMED_AT = "sc_member_deposit_confirmed_at";
export const SC_MEMBER_DEPOSIT_PRESENT_ITEM_IDS = "sc_member_deposit_present_item_ids";

export type MemberIntakeTransferDepositItem = {
  item_id: string;
  title: string | null;
  sort_order: number;
};

export type MemberIntakeTransferDepositPrompt = {
  shipment_id: string;
  transfer_id: string;
  shipment_status: string;
  items: MemberIntakeTransferDepositItem[];
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readDepositConfirmedAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const at = (metadata as Record<string, unknown>)[SC_MEMBER_DEPOSIT_CONFIRMED_AT];
  return typeof at === "string" && at.trim() ? at.trim() : null;
}

async function loadTransferVerifyItems(
  service: SupabaseClient,
  shipmentId: string,
  transferId: string,
): Promise<MemberIntakeTransferDepositItem[]> {
  const links = await loadActiveTransferItemIds(service, transferId);
  if (links.length === 0) return [];

  const { data: linkRows } = await service
    .from("transfer_items")
    .select("item_id, sort_order")
    .eq("transfer_id", transferId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  const orderedIds =
    (linkRows ?? []).length > 0
      ? (linkRows ?? []).map((l) => String((l as { item_id?: string }).item_id ?? "")).filter(Boolean)
      : links;

  const { data: itemRows } = await service
    .from("items")
    .select("id, title, owner_user_id")
    .in("id", orderedIds)
    .is("deleted_at", null);

  const titleById = new Map<string, string | null>();
  for (const row of itemRows ?? []) {
    const id = String((row as { id?: string }).id ?? "");
    const title = (row as { title?: string | null }).title;
    titleById.set(id, typeof title === "string" && title.trim() ? title.trim() : null);
  }

  return orderedIds.map((itemId, index) => {
    const link = (linkRows ?? []).find((l) => String((l as { item_id?: string }).item_id ?? "") === itemId);
    return {
      item_id: itemId,
      title: titleById.get(itemId) ?? null,
      sort_order:
        typeof (link as { sort_order?: number } | undefined)?.sort_order === "number"
          ? (link as { sort_order: number }).sort_order
          : index,
    };
  });
}

async function assertMemberOwnsTransfer(
  service: SupabaseClient,
  userId: string,
  transferId: string,
): Promise<boolean> {
  const { data: transfer } = await service
    .from("transfers")
    .select("user_id")
    .eq("id", transferId)
    .is("deleted_at", null)
    .maybeSingle();
  return String((transfer as { user_id?: string } | null)?.user_id ?? "") === userId;
}

/** File d’attente : colis déposé au relais, contenu pas encore confirmé par la membre. */
export async function fetchMemberIntakeTransferDepositConfirmQueue(
  service: SupabaseClient,
  userId: string,
): Promise<MemberIntakeTransferDepositPrompt[]> {
  const { data: transfers } = await service
    .from("transfers")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("completed_at", null);

  const out: MemberIntakeTransferDepositPrompt[] = [];

  for (const row of transfers ?? []) {
    const transferId = String((row as { id?: string }).id ?? "");
    if (!transferId) continue;

    const { data: ship } = await service
      .from("shipments")
      .select("id, status")
      .eq("transfer_id", transferId)
      .eq("context", "member_intake")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!ship?.id) continue;
    const status = String(ship.status ?? "").trim().toLowerCase();
    if (status !== "dropped_out" && status !== "dropped_in") continue;

    const { data: dest } = await service
      .from("shipment_destinations")
      .select("metadata")
      .eq("shipment_id", String(ship.id))
      .limit(1)
      .maybeSingle();

    if (readDepositConfirmedAt(dest?.metadata)) continue;

    const items = await loadTransferVerifyItems(service, String(ship.id), transferId);
    if (items.length === 0) continue;

    out.push({
      shipment_id: String(ship.id),
      transfer_id: transferId,
      shipment_status: status,
      items,
    });
  }

  return out.sort((a, b) => a.shipment_id.localeCompare(b.shipment_id));
}

async function reconcileMemberIntakeTransferOnMemberDeposit(
  service: SupabaseClient,
  params: {
    shipmentId: string;
    transferId: string;
    userId: string;
    declaredItemIds: string[];
    presentItemIds: string[];
  },
): Promise<{ ok: true; item_ids: string[] } | { ok: false; error: string; status: number }> {
  const sid = params.shipmentId.trim();
  const tid = params.transferId.trim();
  const declared = [...new Set(params.declaredItemIds.map((x) => x.trim()).filter(Boolean))].sort();
  const present = [...new Set(params.presentItemIds.map((x) => x.trim()).filter(Boolean))].sort();

  if (declared.length === 0) {
    return { ok: false, error: "Aucune pièce déclarée sur cet envoi.", status: 400 };
  }
  if (present.length === 0) {
    return { ok: false, error: "Coche au moins une pièce présente dans le colis.", status: 400 };
  }

  if (!(await assertMemberOwnsTransfer(service, params.userId, tid))) {
    return { ok: false, error: "Accès refusé.", status: 403 };
  }

  const declaredSet = new Set(declared);
  for (const id of present) {
    if (!declaredSet.has(id)) {
      return { ok: false, error: "Pièce invalide.", status: 400 };
    }
  }

  const { data: links } = await service
    .from("transfer_items")
    .select("id, item_id")
    .eq("transfer_id", tid)
    .is("deleted_at", null);

  const activeIds = new Set((links ?? []).map((l) => String((l as { item_id?: string }).item_id ?? "")));
  if (activeIds.size !== declaredSet.size || ![...declaredSet].every((id) => activeIds.has(id))) {
    return {
      ok: false,
      error: "Ton envoi a changé entre-temps. Recharge la page et réessaie.",
      status: 409,
    };
  }

  const now = new Date().toISOString();
  const presentSet = new Set(present);
  const removed = declared.filter((id) => !presentSet.has(id));

  for (const row of links ?? []) {
    const itemId = String((row as { item_id?: string }).item_id ?? "");
    if (!itemId || presentSet.has(itemId)) continue;
    const { error } = await service
      .from("transfer_items")
      .update({ deleted_at: now })
      .eq("id", (row as { id: string }).id)
      .is("deleted_at", null);
    if (error) return { ok: false, error: error.message, status: 500 };
  }

  const sortedPresent = [...presentSet].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < sortedPresent.length; i++) {
    const itemId = sortedPresent[i]!;
    const link = (links ?? []).find((l) => String((l as { item_id?: string }).item_id ?? "") === itemId);
    if (!link) continue;
    await service
      .from("transfer_items")
      .update({ sort_order: i })
      .eq("id", (link as { id: string }).id)
      .is("deleted_at", null);
  }

  const syncedSource = await syncMemberIntakeShipmentItemIntakeLink(service, sid, sortedPresent, {
    mergeWithExistingSlots: false,
    ownerUserId: params.userId,
  });
  if (!syncedSource.ok) {
    return { ok: false, error: syncedSource.error, status: 500 };
  }

  const { data: dest } = await service
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", sid)
    .limit(1)
    .maybeSingle();

  if (dest?.id) {
    const prev =
      dest.metadata && typeof dest.metadata === "object" && !Array.isArray(dest.metadata)
        ? { ...(dest.metadata as Record<string, unknown>) }
        : {};
    prev[DEST_INTAKE_ITEM_IDS] = sortedPresent.join(",");
    prev[SC_MEMBER_DEPOSIT_CONFIRMED_AT] = now;
    prev[SC_MEMBER_DEPOSIT_PRESENT_ITEM_IDS] = sortedPresent.join(",");
    await service.from("shipment_destinations").update({ metadata: prev }).eq("id", dest.id);
  }

  for (const itemId of sortedPresent) {
    const patchRes = await patchItemIntakeSendcloudMetadata(service, itemId, {
      [SC_MEMBER_INTAKE_SHIPMENT_ID]: sid,
      notes_interne: `Membre : pièce confirmée dans le colis déposé (${now}).`.slice(0, 2000),
    });
    if (!patchRes.ok) return { ok: false, error: patchRes.message, status: 500 };
  }

  for (const itemId of removed) {
    const patchRes = await patchItemIntakeSendcloudMetadata(
      service,
      itemId,
      {
        notes_interne:
          `Membre : pièce absente du colis déposé — retirée de l'envoi ${sid.slice(0, 8)}… (${now}).`.slice(
            0,
            2000,
          ),
      },
      { removeKeys: [SC_MEMBER_INTAKE_SHIPMENT_ID] },
    );
    if (!patchRes.ok) return { ok: false, error: patchRes.message, status: 500 };
    try {
      await reverseLendIntakeVerifiedCreditIfPosted(
        service,
        itemId,
        "member_intake_deposit_uncheck",
      );
    } catch {
      /* RPC absente en local : ignorer */
    }
    await clearItemIntakeShippingLabelMetadata(service, itemId);
  }

  if (removed.length > 0) {
    const reassigned = await reassignItemsToUndepositedTransfers(service, {
      userId: params.userId,
      itemIds: removed,
      excludeTransferId: tid,
    });
    if (!reassigned.ok) return { ok: false, error: reassigned.error, status: 500 };
  }

  return { ok: true, item_ids: sortedPresent };
}

export async function runMemberIntakeTransferDepositConfirm(
  service: SupabaseClient,
  params: {
    userId: string;
    shipmentId: string;
    presentItemIds: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sid = params.shipmentId.trim();
  if (!isUuid(sid)) {
    return { ok: false, error: "shipment_id invalide", status: 400 };
  }

  const { data: ship } = await service
    .from("shipments")
    .select("id, status, tracking_number, transfer_id")
    .eq("id", sid)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .maybeSingle();

  if (!ship?.id || !ship.transfer_id) {
    return { ok: false, error: "Envoi introuvable.", status: 404 };
  }

  const transferId = String(ship.transfer_id);
  if (!(await assertMemberOwnsTransfer(service, params.userId, transferId))) {
    return { ok: false, error: "Accès refusé.", status: 403 };
  }

  const status = String(ship.status ?? "").trim().toLowerCase();
  if (status !== "dropped_out" && status !== "dropped_in") {
    return { ok: false, error: "Cet envoi n’est plus en attente de confirmation.", status: 409 };
  }

  const { data: dest } = await service
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", sid)
    .limit(1)
    .maybeSingle();
  if (readDepositConfirmedAt(dest?.metadata)) {
    return { ok: false, error: "Contenu du colis déjà confirmé.", status: 409 };
  }

  const declaredIds = await loadActiveTransferItemIds(service, transferId);
  const reconciled = await reconcileMemberIntakeTransferOnMemberDeposit(service, {
    shipmentId: sid,
    transferId,
    userId: params.userId,
    declaredItemIds: declaredIds,
    presentItemIds: params.presentItemIds,
  });
  if (!reconciled.ok) return reconciled;

  const tr = await transitionShipmentStatus(service, {
    shipmentId: sid,
    ifCurrentStatus: status,
    toStatus: "in_transit_out",
    actorUserId: params.userId,
    reason: "Membre : confirmation contenu colis déposé au relais",
    source: "member_app_transfer_deposit_confirm",
    context: {
      transfer_id: transferId,
      present_item_ids: reconciled.item_ids,
    },
    trackingNumber:
      typeof ship.tracking_number === "string" ? ship.tracking_number : null,
  });

  if (!tr.ok) {
    if (tr.error === "STATUS_MISMATCH") {
      return { ok: false, error: "Statut modifié entre-temps. Recharge la page.", status: 409 };
    }
    return { ok: false, error: tr.error, status: 500 };
  }

  return { ok: true };
}
