import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dès qu’un opérateur répond (Discord → chat) sur une conversation liée à un litige,
 * passe le dossier `open` → `in_review` (« En traitement »).
 * No-op si déjà traité / clôturé, ou si pas de litige lié.
 */
export async function markLinkedCartDisputeInReviewFromChat(
  admin: SupabaseClient,
  conversation: { id: string; cart_dispute_id?: string | null },
): Promise<void> {
  const conversationId = conversation.id?.trim();
  if (!conversationId) return;

  let disputeId =
    typeof conversation.cart_dispute_id === "string" ? conversation.cart_dispute_id.trim() : "";

  if (!disputeId) {
    const { data } = await admin
      .from("cart_disputes")
      .select("id")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    disputeId = typeof data?.id === "string" ? data.id : "";
  }
  if (!disputeId) return;

  const { error } = await admin
    .from("cart_disputes")
    .update({ status: "in_review", updated_at: new Date().toISOString() })
    .eq("id", disputeId)
    .eq("status", "open");

  if (error) {
    console.warn("[mark-cart-dispute-in-review-from-chat]", error.message);
  }
}
