import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Archive (inbox membre) la conversation chatbot liée à un litige résolu / clôturé.
 */
export async function archiveItemChatForDisputeIds(
  admin: SupabaseClient,
  disputeIds: string[],
): Promise<void> {
  const ids = [...new Set(disputeIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;

  const now = new Date().toISOString();
  const convIds = new Set<string>();

  const { data: byDisputeLink } = await admin
    .from("item_chat_conversations" as never)
    .select("id")
    .in("cart_dispute_id", ids)
    .is("visitor_archived_at", null);
  for (const row of byDisputeLink ?? []) {
    const id = String((row as { id?: string }).id ?? "").trim();
    if (id) convIds.add(id);
  }

  const { data: disputeRows } = await admin
    .from("cart_disputes")
    .select("conversation_id")
    .in("id", ids);
  for (const row of disputeRows ?? []) {
    const id = String((row as { conversation_id?: string | null }).conversation_id ?? "").trim();
    if (id) convIds.add(id);
  }

  if (convIds.size === 0) return;

  const { error } = await admin
    .from("item_chat_conversations" as never)
    .update({
      visitor_archived_at: now,
      updated_at: now,
    } as never)
    .in("id", [...convIds])
    .is("visitor_archived_at", null);

  if (error) {
    console.error("[dispute-chat] archive failed", error.message, { disputeIds: ids });
  }
}
