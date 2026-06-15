import type { SupabaseClient } from "@supabase/supabase-js";

/** Annule un crédit prêteur déjà versé (pièce recyclée en nouvel envoi). */
export async function reverseLendIntakeVerifiedCreditIfPosted(
  service: SupabaseClient,
  itemId: string,
  reason = "intake_fulfillment_reset",
): Promise<void> {
  const id = itemId.trim();
  if (!id) return;

  const { error } = await service.rpc("wallet_reverse_lend_intake_verified_credit", {
    p_item_id: id,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
