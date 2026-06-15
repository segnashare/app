import type { SupabaseClient } from "@supabase/supabase-js";

const DEST_OUTTAKE_ITEM_IDS = "sc_outtake_item_ids";

export function buildStableMemberOuttakeOrderNumber(itemIds: string[]): string {
  const sorted = [...itemIds].map((x) => x.trim()).filter(Boolean).sort();
  const compact = sorted.map((id) => id.replace(/-/g, "").slice(0, 8)).join("");
  return `OT-${compact.slice(0, 24)}`.toUpperCase();
}

export async function readMemberOuttakeDestinationMetadata(
  service: SupabaseClient,
  shipmentId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await service
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", shipmentId.trim())
    .limit(1)
    .maybeSingle();

  const meta = data?.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return meta as Record<string, unknown>;
}

export async function ensureMemberOuttakeShipmentForTransfer(
  service: SupabaseClient,
  params: {
    ownerUserId: string;
    transferId: string;
    itemIds: string[];
  },
): Promise<{ ok: true; shipmentId: string } | { ok: false; error: string }> {
  const uid = params.ownerUserId.trim();
  const tid = params.transferId.trim();
  const sorted = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (!uid || !tid || sorted.length === 0) {
    return { ok: false, error: "Paramètres invalides." };
  }

  const { data: existing } = await service
    .from("shipments")
    .select("id")
    .eq("transfer_id", tid)
    .eq("context", "member_outtake")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await syncMemberOuttakeShipmentDestination(service, String(existing.id), sorted);
    return { ok: true, shipmentId: String(existing.id) };
  }

  const orderNumber = buildStableMemberOuttakeOrderNumber(sorted);
  const { data: ship, error: shipErr } = await service
    .from("shipments")
    .insert({
      context: "member_outtake",
      transfer_id: tid,
      status: "pending",
    })
    .select("id")
    .single();

  if (shipErr || !ship?.id) {
    return { ok: false, error: shipErr?.message ?? "Création envoi impossible." };
  }

  const shipmentId = String(ship.id);
  const { error: destErr } = await service.from("shipment_destinations").insert({
    shipment_id: shipmentId,
    metadata: {
      sc_order_number: orderNumber,
      [DEST_OUTTAKE_ITEM_IDS]: sorted.join(","),
      sc_outtake_owner_user_id: uid,
    },
  });
  if (destErr) {
    await service.from("shipments").update({ deleted_at: new Date().toISOString() }).eq("id", shipmentId);
    return { ok: false, error: destErr.message };
  }

  return { ok: true, shipmentId };
}

export async function syncMemberOuttakeShipmentDestination(
  service: SupabaseClient,
  shipmentId: string,
  itemIds: string[],
): Promise<void> {
  const sorted = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  const orderNumber = buildStableMemberOuttakeOrderNumber(sorted);

  const { data: dest } = await service
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", shipmentId.trim())
    .limit(1)
    .maybeSingle();

  const prev =
    dest?.metadata && typeof dest.metadata === "object" && !Array.isArray(dest.metadata)
      ? { ...(dest.metadata as Record<string, unknown>) }
      : {};

  prev.sc_order_number = orderNumber;
  prev[DEST_OUTTAKE_ITEM_IDS] = sorted.join(",");

  if (dest?.id) {
    await service.from("shipment_destinations").update({ metadata: prev }).eq("id", dest.id);
  }
}

export async function resolveMemberOuttakeItemIdsFromShipment(
  service: SupabaseClient,
  shipmentId: string,
): Promise<string[]> {
  const meta = await readMemberOuttakeDestinationMetadata(service, shipmentId);
  const csv = typeof meta?.[DEST_OUTTAKE_ITEM_IDS] === "string" ? meta[DEST_OUTTAKE_ITEM_IDS].trim() : "";
  if (csv) {
    return [...new Set(csv.split(",").map((x) => x.trim()).filter(Boolean))];
  }

  const { data: ship } = await service
    .from("shipments")
    .select("transfer_id")
    .eq("id", shipmentId.trim())
    .maybeSingle();

  const transferId = ship?.transfer_id ? String(ship.transfer_id) : "";
  if (!transferId) return [];

  const { data: links } = await service
    .from("transfer_items")
    .select("item_id")
    .eq("transfer_id", transferId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  return (links ?? [])
    .map((row) => String((row as { item_id?: string }).item_id ?? "").trim())
    .filter(Boolean);
}
