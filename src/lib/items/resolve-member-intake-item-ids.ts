import type { SupabaseClient } from "@supabase/supabase-js";

import { readMemberIntakeShipmentIdFromMetadata } from "@/lib/items/intake-shipping-metadata";

const SC_MEMBER_INTAKE_SHIPMENT_ID = "sc_member_intake_shipment_id";

const DEST_INTAKE_ITEM_IDS = "sc_intake_item_ids";

function parseDestinationItemIds(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))];
}

/** Pièces liées à une expédition `member_intake` (transfer_items + repli metadata). */
export async function resolveMemberIntakeItemIds(
  service: SupabaseClient,
  shipmentId: string,
): Promise<string[]> {
  const sid = shipmentId.trim();
  if (!sid) return [];

  const { data: ship } = await service
    .from("shipments")
    .select("transfer_id")
    .eq("id", sid)
    .maybeSingle();

  if (ship?.transfer_id) {
    const transferId = String(ship.transfer_id);
    const { data: activeLinks } = await service
      .from("transfer_items")
      .select("item_id")
      .eq("transfer_id", transferId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    let fromTransfer = (activeLinks ?? []).map((l) => String(l.item_id)).filter(Boolean);

    if (fromTransfer.length === 0) {
      const { data: archivedLinks } = await service
        .from("transfer_items")
        .select("item_id")
        .eq("transfer_id", transferId)
        .not("deleted_at", "is", null)
        .order("sort_order", { ascending: true });
      fromTransfer = (archivedLinks ?? []).map((l) => String(l.item_id)).filter(Boolean);
    }

    if (fromTransfer.length > 0) return fromTransfer;
  }

  const seen = new Set<string>();

  const { data: byMeta } = await service
    .from("item_intake")
    .select("item_id, metadata")
    .filter(`metadata->sendcloud->>${SC_MEMBER_INTAKE_SHIPMENT_ID}`, "eq", sid)
    .limit(50);

  for (const row of byMeta ?? []) {
    const id = String(row.item_id);
    const linked = readMemberIntakeShipmentIdFromMetadata(row.metadata);
    if (linked === sid) seen.add(id);
  }

  const { data: dest } = await service
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", sid)
    .limit(1)
    .maybeSingle();

  const destMeta =
    dest?.metadata && typeof dest.metadata === "object" && !Array.isArray(dest.metadata)
      ? (dest.metadata as Record<string, unknown>)
      : null;
  for (const id of parseDestinationItemIds(destMeta?.[DEST_INTAKE_ITEM_IDS])) {
    seen.add(id);
  }

  return [...seen];
}
