import type { SupabaseClient } from "@supabase/supabase-js";

import {
  blocksIntakeUntilPendingShipmentsSent,
  fetchPendingMemberIntakeShippingGate,
} from "@/lib/items/member-intake-shipping-pipeline-gate";
import { MEMBER_INTAKE_SHIPMENT_MAX_ITEMS } from "@/lib/items/member-intake-shipment";

export type ItemIntakeListingStage =
  | "draft"
  | "evaluation"
  | "evaluated"
  | "validation_pending"
  | "validated"
  | "refused";

/**
 * Synchronise item_intake.listing_stage côté membre (RLS : propriétaire uniquement).
 */
export async function setItemIntakeListingStage(
  client: SupabaseClient,
  itemId: string,
  listingStage: ItemIntakeListingStage,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (listingStage === "validated") {
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return { ok: false, message: "Session invalide." };
    }
    const gate = await fetchPendingMemberIntakeShippingGate(client, user.id);
    if (blocksIntakeUntilPendingShipmentsSent(gate.pendingItemIds.length)) {
      return {
        ok: false,
        message: `Envoie d'abord tes ${MEMBER_INTAKE_SHIPMENT_MAX_ITEMS} pièces vers Segna avant de valider une nouvelle entrée au catalogue.`,
      };
    }
  }

  const { data: existing, error: selErr } = await client
    .from("item_intake")
    .select("item_id")
    .eq("item_id", itemId)
    .maybeSingle();

  if (selErr) {
    return { ok: false, message: selErr.message };
  }

  if (existing?.item_id) {
    const { error } = await client
      .from("item_intake")
      .update({
        listing_stage: listingStage,
        deleted_at: null,
      })
      .eq("item_id", itemId);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  const { error: insErr } = await client.from("item_intake").insert({
    item_id: itemId,
    listing_stage: listingStage,
    metadata: {},
  });
  if (insErr) return { ok: false, message: insErr.message };
  return { ok: true };
}

/**
 * Force une nouvelle transition vers `evaluation` pour relancer les webhooks liés
 * (utile quand l'item était déjà en `evaluation` et a été modifié).
 */
export async function restartItemIntakeEvaluation(
  client: SupabaseClient,
  itemId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: existing, error: selErr } = await client
    .from("item_intake")
    .select("item_id,metadata")
    .eq("item_id", itemId)
    .maybeSingle();

  if (selErr) {
    return { ok: false, message: selErr.message };
  }

  if (!existing?.item_id) {
    return setItemIntakeListingStage(client, itemId, "evaluation");
  }

  const metadata =
    existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? ({ ...(existing.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  delete metadata.ai_evaluation_summary;
  delete metadata.ai_evaluation_summary_updated_at;

  const { error: toDraftErr } = await client
    .from("item_intake")
    .update({ listing_stage: "draft", metadata })
    .eq("item_id", itemId);
  if (toDraftErr) return { ok: false, message: toDraftErr.message };

  const { error: toEvalErr } = await client
    .from("item_intake")
    .update({ listing_stage: "evaluation" })
    .eq("item_id", itemId);
  if (toEvalErr) return { ok: false, message: toEvalErr.message };

  return { ok: true };
}
