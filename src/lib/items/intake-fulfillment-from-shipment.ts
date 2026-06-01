import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INTAKE_FULFILLMENT_READY,
  INTAKE_FULFILLMENT_SHIPPING,
  normalizeIntakeFulfillmentStage,
} from "@/lib/items/intake-fulfillment-stages";
import { SC_MEMBER_INTAKE_SHIPMENT_ID } from "@/lib/items/member-intake-shipment";
import { resolveMemberIntakeItemIds } from "@/lib/items/resolve-member-intake-item-ids";

/** Expédition membre → Segna : passage `dropped_out` (dépôt relais) → pièce en transit. */
export async function promoteIntakeItemsToShippingOnDummyShipmentDeposited(
  service: SupabaseClient,
  shipmentId: string,
): Promise<void> {
  const sid = shipmentId.trim();
  if (!sid) return;

  const memberIntakeItemIds = new Set(await resolveMemberIntakeItemIds(service, sid));

  const { data: byDbShipment } = await service
    .from("item_intake")
    .select("item_id, listing_stage, fulfillment_stage, metadata")
    .filter(`metadata->sendcloud->>${SC_MEMBER_INTAKE_SHIPMENT_ID}`, "eq", sid)
    .limit(50);

  const { data: byLegacyDummy } = await service
    .from("item_intake")
    .select("item_id, listing_stage, fulfillment_stage, metadata")
    .filter("metadata->sendcloud->>sc_dummy_shipment_id", "eq", sid)
    .limit(50);

  const { data: byResolvedIds } =
    memberIntakeItemIds.size > 0
      ? await service
          .from("item_intake")
          .select("item_id, listing_stage, fulfillment_stage, metadata")
          .in("item_id", [...memberIntakeItemIds])
          .limit(50)
      : { data: [] as typeof byDbShipment };

  const seen = new Set<string>();
  const rows = [...(byDbShipment ?? []), ...(byLegacyDummy ?? []), ...(byResolvedIds ?? [])].filter((row) => {
    const id = String(row.item_id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  if (!rows.length) return;

  for (const row of rows) {
    if (String(row.listing_stage) !== "validated") continue;
    const fs = normalizeIntakeFulfillmentStage(row.fulfillment_stage);
    if (fs !== INTAKE_FULFILLMENT_READY && fs !== INTAKE_FULFILLMENT_SHIPPING) continue;

    const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
    const sc =
      meta.sendcloud && typeof meta.sendcloud === "object"
        ? (meta.sendcloud as Record<string, unknown>)
        : {};
    const itemId = String(row.item_id);
    const dbShipId =
      typeof sc[SC_MEMBER_INTAKE_SHIPMENT_ID] === "string"
        ? sc[SC_MEMBER_INTAKE_SHIPMENT_ID].trim()
        : "";
    const dummyId = typeof sc.sc_dummy_shipment_id === "string" ? sc.sc_dummy_shipment_id.trim() : "";
    const linkedToShipment =
      dbShipId === sid || dummyId === sid || memberIntakeItemIds.has(itemId);
    if (!linkedToShipment) continue;

    if (fs === INTAKE_FULFILLMENT_SHIPPING) continue;

    await service
      .from("item_intake")
      .update({ fulfillment_stage: INTAKE_FULFILLMENT_SHIPPING })
      .eq("item_id", String(row.item_id));
  }
}
