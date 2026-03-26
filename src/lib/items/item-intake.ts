import type { SupabaseClient } from "@supabase/supabase-js";

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
  const { data: existing, error: selErr } = await client
    .from("item_intake")
    .select("item_id")
    .eq("item_id", itemId)
    .maybeSingle();

  if (selErr) {
    return { ok: false, message: selErr.message };
  }

  if (existing?.item_id) {
    const { error } = await client.from("item_intake").update({ listing_stage: listingStage }).eq("item_id", itemId);
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
