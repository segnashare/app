import type { SupabaseClient } from "@supabase/supabase-js";

import { INTAKE_FULFILLMENT_READY } from "@/lib/items/intake-fulfillment-stages";
import { loadActiveTransferItemIds } from "@/lib/items/member-transfer-items";

export type MemberTransferShipmentContext = "member_intake" | "member_outtake";

/** Contexte logistique d'une enveloppe (colis intake ou retour outtake membre). */
export async function resolveTransferShipmentContext(
  service: SupabaseClient,
  transferId: string,
): Promise<MemberTransferShipmentContext | null> {
  const tid = transferId.trim();
  if (!tid) return null;

  const { data: rows } = await service
    .from("shipments")
    .select("context")
    .eq("transfer_id", tid)
    .in("context", ["member_intake", "member_outtake"])
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(2);

  for (const row of rows ?? []) {
    const ctx = String((row as { context?: string }).context ?? "").trim();
    if (ctx === "member_intake" || ctx === "member_outtake") {
      return ctx;
    }
  }

  return inferTransferShipmentContextFromItems(service, tid);
}

async function inferTransferShipmentContextFromItems(
  service: SupabaseClient,
  transferId: string,
): Promise<MemberTransferShipmentContext | null> {
  const itemIds = await loadActiveTransferItemIds(service, transferId);
  if (itemIds.length === 0) return null;

  const [{ data: outtakeRows }, { data: intakeRows }, { data: itemRows }] = await Promise.all([
    service.from("item_outtake").select("item_id, stage").in("item_id", itemIds),
    service.from("item_intake").select("item_id, listing_stage, fulfillment_stage").in("item_id", itemIds),
    service.from("items").select("id, status").in("id", itemIds).is("deleted_at", null),
  ]);

  const statusById = new Map<string, string>();
  for (const row of itemRows ?? []) {
    statusById.set(String((row as { id?: string }).id ?? ""), String((row as { status?: string }).status ?? ""));
  }

  const outtakeById = new Map<string, string>();
  for (const row of outtakeRows ?? []) {
    outtakeById.set(String((row as { item_id?: string }).item_id ?? ""), String((row as { stage?: string }).stage ?? ""));
  }

  let outtakeCount = 0;
  let intakeCount = 0;
  for (const itemId of itemIds) {
    const stage = outtakeById.get(itemId)?.trim().toLowerCase() ?? "";
    const status = statusById.get(itemId)?.trim().toLowerCase() ?? "";
    if (stage === "return_open" && status === "retired") outtakeCount += 1;

    const intake = (intakeRows ?? []).find((r) => String((r as { item_id?: string }).item_id) === itemId) as
      | { listing_stage?: string; fulfillment_stage?: string | null }
      | undefined;
    const ls = String(intake?.listing_stage ?? "").trim().toLowerCase();
    const fs = String(intake?.fulfillment_stage ?? "").trim().toLowerCase();
    if (ls === "validated" && (fs === INTAKE_FULFILLMENT_READY || fs === "shipping" || fs === "")) {
      intakeCount += 1;
    }
  }

  if (outtakeCount === itemIds.length) return "member_outtake";
  if (intakeCount === itemIds.length) return "member_intake";
  return null;
}
