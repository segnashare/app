import type { SupabaseClient } from "@supabase/supabase-js";

import { SC_MEMBER_INTAKE_SHIPMENT_ID } from "@/lib/items/member-intake-shipment";
import { readMemberIntakeShipmentIdFromMetadata } from "@/lib/items/intake-shipping-metadata";

const DEST_INTAKE_ITEM_IDS = "sc_intake_item_ids";

function parseDestinationItemIds(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))];
}

/** Pièces liées à une expédition `member_intake` (metadata intake + destination). */
export async function resolveMemberIntakeItemIds(
  service: SupabaseClient,
  shipmentId: string,
): Promise<string[]> {
  const sid = shipmentId.trim();
  if (!sid) return [];

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
