import type { SupabaseClient } from "@supabase/supabase-js";

import { readShippingPreferSolo } from "@/lib/items/intake-shipping-metadata";
import { MEMBER_INTAKE_SHIPMENT_MAX_ITEMS } from "@/lib/items/member-intake-shipment";

export type IntakeRowForShippingPipelineGate = {
  listing_stage?: string | null;
  fulfillment_stage?: string | null;
  metadata?: unknown;
};

export function itemIntakeEligibleForPendingShippingGate(
  intake: IntakeRowForShippingPipelineGate | null | undefined,
): boolean {
  const ls = String(intake?.listing_stage ?? "").toLowerCase();
  const fs = String(intake?.fulfillment_stage ?? "").toLowerCase();
  return ls === "validated" && (fs === "ready" || fs === "shipping" || fs === "");
}

export function pendingShipmentsAreSplit(
  rows: Array<{ intake?: IntakeRowForShippingPipelineGate | null }>,
): boolean {
  if (rows.length < MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) return false;
  return rows.every((r) => readShippingPreferSolo(r.intake?.metadata));
}

export type PendingMemberIntakeShippingGateSnapshot = {
  pendingItemIds: string[];
  shipmentsSplit: boolean;
};

function normalizeItemIntakeEmbed(raw: unknown): IntakeRowForShippingPipelineGate | null {
  const emb = Array.isArray(raw) ? raw[0] : raw;
  if (!emb || typeof emb !== "object") return null;
  const o = emb as Record<string, unknown>;
  return {
    listing_stage: typeof o.listing_stage === "string" ? o.listing_stage : null,
    fulfillment_stage: typeof o.fulfillment_stage === "string" ? o.fulfillment_stage : null,
    metadata: o.metadata,
  };
}

export async function fetchPendingMemberIntakeShippingGate(
  service: SupabaseClient,
  userId: string,
): Promise<PendingMemberIntakeShippingGateSnapshot> {
  const { data: rows, error } = await service
    .from("items")
    .select("id, item_intake(listing_stage, fulfillment_stage, metadata)")
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .limit(100);

  if (error || !rows?.length) {
    return { pendingItemIds: [], shipmentsSplit: false };
  }

  const pendingRows: Array<{ id: string; intake: IntakeRowForShippingPipelineGate | null }> = [];
  for (const row of rows) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id) continue;
    const intake = normalizeItemIntakeEmbed((row as { item_intake?: unknown }).item_intake);
    if (!itemIntakeEligibleForPendingShippingGate(intake)) continue;
    pendingRows.push({ id, intake });
  }

  const pendingItemIds = pendingRows.map((r) => r.id).sort((a, b) => a.localeCompare(b));
  const shipmentsSplit = pendingShipmentsAreSplit(pendingRows);
  return {
    pendingItemIds,
    shipmentsSplit,
  };
}
