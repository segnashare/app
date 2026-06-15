import type { SupabaseClient } from "@supabase/supabase-js";

import { INTAKE_GROUP_MAX_ITEMS } from "@/lib/items/member-intake-groups.shared";

export async function findActiveTransferIdForItem(
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

export async function findMemberIntakeShipmentIdByItemId(
  service: SupabaseClient,
  itemId: string,
): Promise<string | null> {
  const transferId = await findActiveTransferIdForItem(service, itemId);
  if (!transferId) return null;

  const { data } = await service
    .from("shipments")
    .select("id")
    .eq("transfer_id", transferId)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id ? String(data.id) : null;
}

/** Pièces actives d'une enveloppe logistique (ordre transfer_items). */
export async function loadActiveTransferItemIds(
  service: SupabaseClient,
  transferId: string,
): Promise<string[]> {
  const tid = transferId.trim();
  if (!tid) return [];

  const { data: links } = await service
    .from("transfer_items")
    .select("item_id, sort_order")
    .eq("transfer_id", tid)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  return (links ?? [])
    .map((row) => String((row as { item_id?: string }).item_id ?? "").trim())
    .filter(Boolean);
}

/** Transfer actif partagé par toutes les pièces (sinon `null`). */
export async function resolveSharedTransferIdForItems(
  service: SupabaseClient,
  itemIds: string[],
): Promise<string | null> {
  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sorted.length === 0) return null;

  let shared: string | null = null;
  for (const itemId of sorted) {
    const transferId = await findActiveTransferIdForItem(service, itemId);
    if (!transferId) return null;
    if (!shared) {
      shared = transferId;
    } else if (shared !== transferId) {
      return null;
    }
  }
  return shared;
}

/** Synchronise les pièces actives d'une enveloppe logistique. */
export async function syncTransferItems(
  service: SupabaseClient,
  transferId: string,
  itemIds: string[],
  options?: { mergeWithExisting?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = transferId.trim();
  let targetIds: string[];

  if (options?.mergeWithExisting) {
    const { data: existing } = await service
      .from("transfer_items")
      .select("item_id, sort_order")
      .eq("transfer_id", tid)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });

    const preserved: string[] = [];
    const targetSet = new Set(
      [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].slice(0, INTAKE_GROUP_MAX_ITEMS),
    );
    for (const row of existing ?? []) {
      const id = String(row.item_id ?? "").trim();
      if (!id || !targetSet.has(id) || preserved.includes(id)) continue;
      preserved.push(id);
    }
    const appended = [...targetSet]
      .filter((id) => !preserved.includes(id))
      .sort((a, b) => a.localeCompare(b));
    targetIds = [...preserved, ...appended].slice(0, INTAKE_GROUP_MAX_ITEMS);
  } else {
    targetIds = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, INTAKE_GROUP_MAX_ITEMS);
  }

  if (targetIds.length === 0) {
    return { ok: false, error: "Aucune pièce." };
  }

  const { data: current } = await service
    .from("transfer_items")
    .select("id, item_id")
    .eq("transfer_id", tid)
    .is("deleted_at", null);

  const currentIds = new Set((current ?? []).map((r) => String(r.item_id)));
  const targetSet = new Set(targetIds);
  const now = new Date().toISOString();

  for (const row of current ?? []) {
    const id = String(row.item_id);
    if (!targetSet.has(id)) {
      const { error } = await service
        .from("transfer_items")
        .update({ deleted_at: now })
        .eq("id", row.id)
        .is("deleted_at", null);
      if (error) return { ok: false, error: error.message };
    }
  }

  for (let i = 0; i < targetIds.length; i++) {
    const itemId = targetIds[i]!;
    if (currentIds.has(itemId)) {
      const link = (current ?? []).find((r) => String(r.item_id) === itemId);
      if (link) {
        await service
          .from("transfer_items")
          .update({ sort_order: i })
          .eq("id", link.id)
          .is("deleted_at", null);
      }
      continue;
    }

    const activeElsewhere = await findActiveTransferIdForItem(service, itemId);
    if (activeElsewhere && activeElsewhere !== tid) {
      const { data: staleLink } = await service
        .from("transfer_items")
        .select("id, transfer_id")
        .eq("item_id", itemId)
        .is("deleted_at", null)
        .maybeSingle();

      if (staleLink?.id) {
        const { data: staleTransfer } = await service
          .from("transfers")
          .select("id")
          .eq("id", String(staleLink.transfer_id))
          .is("deleted_at", null)
          .is("completed_at", null)
          .maybeSingle();

        if (!staleTransfer?.id) {
          const { error: detachErr } = await service
            .from("transfer_items")
            .update({ deleted_at: now })
            .eq("id", staleLink.id)
            .is("deleted_at", null);
          if (detachErr) return { ok: false, error: detachErr.message };
        } else {
          return {
            ok: false,
            error: "Cette pièce est encore rattachée à un autre envoi. Réessaie dans un instant.",
          };
        }
      }
    }

    const { error } = await service.from("transfer_items").insert({
      transfer_id: tid,
      item_id: itemId,
      sort_order: i,
    });
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function ensureTransferForUser(
  service: SupabaseClient,
  userId: string,
  itemIds: string[],
): Promise<{ ok: true; transferId: string } | { ok: false; error: string }> {
  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sorted.length === 0) return { ok: false, error: "Aucune pièce." };

  const existingTransferId = await resolveSharedTransferIdForItems(service, sorted);
  if (existingTransferId) {
    const synced = await syncTransferItems(service, existingTransferId, sorted, {
      mergeWithExisting: true,
    });
    if (!synced.ok) return synced;
    return { ok: true, transferId: existingTransferId };
  }

  const { data: transfer, error } = await service
    .from("transfers")
    .insert({ user_id: userId.trim() })
    .select("id")
    .single();

  if (error || !transfer?.id) {
    return { ok: false, error: error?.message ?? "Création enveloppe impossible." };
  }

  const transferId = String(transfer.id);
  const synced = await syncTransferItems(service, transferId, sorted);
  if (!synced.ok) {
    await service.from("transfers").update({ deleted_at: new Date().toISOString() }).eq("id", transferId);
    return synced;
  }

  return { ok: true, transferId };
}

/** Lie un shipment member_intake à son enveloppe et synchronise les pièces. */
export async function syncMemberIntakeShipmentTransferLink(
  service: SupabaseClient,
  shipmentId: string,
  itemIds: string[],
  options?: { mergeWithExisting?: boolean; ownerUserId?: string },
): Promise<{ ok: true; transferId: string } | { ok: false; error: string }> {
  const sid = shipmentId.trim();
  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (!sorted[0]) return { ok: false, error: "Aucune pièce." };

  const { data: ship, error: shipErr } = await service
    .from("shipments")
    .select("transfer_id")
    .eq("id", sid)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .maybeSingle();

  if (shipErr) return { ok: false, error: shipErr.message };

  let transferId = ship?.transfer_id ? String(ship.transfer_id) : null;

  if (!transferId) {
    const sharedTransferId = await resolveSharedTransferIdForItems(service, sorted);
    if (sharedTransferId) {
      transferId = sharedTransferId;
    } else {
      let userId = options?.ownerUserId?.trim() ?? "";
      if (!userId) {
        const { data: item } = await service
          .from("items")
          .select("owner_user_id")
          .eq("id", sorted[0]!)
          .maybeSingle();
        userId = String(item?.owner_user_id ?? "").trim();
      }
      if (!userId) return { ok: false, error: "Propriétaire introuvable." };

      const created = await ensureTransferForUser(service, userId, sorted);
      if (!created.ok) return created;
      transferId = created.transferId;
    }

    const { error: linkErr } = await service
      .from("shipments")
      .update({ transfer_id: transferId, cart_id: null })
      .eq("id", sid)
      .eq("context", "member_intake")
      .is("deleted_at", null);

    if (linkErr) return { ok: false, error: linkErr.message };
  }

  const synced = await syncTransferItems(service, transferId, sorted, {
    mergeWithExisting: options?.mergeWithExisting,
  });
  if (!synced.ok) return synced;

  return { ok: true, transferId };
}
