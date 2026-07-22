import type { SupabaseClient } from "@supabase/supabase-js";

import { discordDeleteThread } from "@/lib/item-chat/discord";
import {
  ITEM_CHAT_USEFULNESS_PROMPT_BODY,
  itemChatDiscordDeleteAfterPromptMs,
  itemChatUsefulnessIdleMs,
} from "@/lib/item-chat/lifecycle-constants";
import type { ItemChatConversationRow } from "@/lib/item-chat/types";

type Admin = SupabaseClient;

function asConv(row: unknown): ItemChatConversationRow {
  return row as ItemChatConversationRow;
}

/**
 * 1) Après 12h sans message → prompt « utile ? » au client.
 * 2) 12h après ce prompt → supprime le fil Discord + clôture la conversation.
 */
export async function runItemChatLifecycle(admin: Admin): Promise<{
  prompted: number;
  closed: number;
  deletedThreads: number;
  errors: number;
}> {
  const now = Date.now();
  const idleBefore = new Date(now - itemChatUsefulnessIdleMs()).toISOString();
  const deleteBefore = new Date(now - itemChatDiscordDeleteAfterPromptMs()).toISOString();

  let prompted = 0;
  let closed = 0;
  let deletedThreads = 0;
  let errors = 0;

  const { data: duePrompt } = await admin
    .from("item_chat_conversations" as never)
    .select("*")
    .eq("status", "open")
    .is("usefulness_prompted_at", null)
    .lt("last_message_at", idleBefore)
    .order("last_message_at", { ascending: true })
    .limit(30);

  for (const row of Array.isArray(duePrompt) ? duePrompt.map(asConv) : []) {
    try {
      const { count } = await admin
        .from("item_chat_messages" as never)
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", row.id)
        .eq("role", "visitor");
      if (!count) continue;

      const at = new Date().toISOString();
      const { error: msgError } = await admin.from("item_chat_messages" as never).insert({
        conversation_id: row.id,
        role: "staff",
        body: ITEM_CHAT_USEFULNESS_PROMPT_BODY,
        discord_message_id: null,
        created_at: at,
      } as never);
      if (msgError) {
        errors += 1;
        continue;
      }

      const { error: updError } = await admin
        .from("item_chat_conversations" as never)
        .update({
          usefulness_prompted_at: at,
          last_message_at: at,
          updated_at: at,
        } as never)
        .eq("id", row.id)
        .is("usefulness_prompted_at", null);
      if (updError) {
        errors += 1;
        continue;
      }
      prompted += 1;
    } catch (e) {
      console.error("[item-chat/lifecycle] prompt failed", row.id, e);
      errors += 1;
    }
  }

  const { data: dueClose } = await admin
    .from("item_chat_conversations" as never)
    .select("*")
    .eq("status", "open")
    .not("usefulness_prompted_at", "is", null)
    .is("discord_thread_deleted_at", null)
    .lt("usefulness_prompted_at", deleteBefore)
    .order("usefulness_prompted_at", { ascending: true })
    .limit(30);

  for (const row of Array.isArray(dueClose) ? dueClose.map(asConv) : []) {
    try {
      const at = new Date().toISOString();
      let deleted = true;
      if (row.discord_thread_id) {
        deleted = await discordDeleteThread(row.discord_thread_id);
        if (deleted) deletedThreads += 1;
      }

      if (!deleted) {
        errors += 1;
        continue;
      }

      const { error } = await admin
        .from("item_chat_conversations" as never)
        .update({
          status: "closed",
          discord_thread_deleted_at: at,
          updated_at: at,
        } as never)
        .eq("id", row.id)
        .eq("status", "open");
      if (error) {
        errors += 1;
        continue;
      }
      closed += 1;
    } catch (e) {
      console.error("[item-chat/lifecycle] close failed", row.id, e);
      errors += 1;
    }
  }

  return { prompted, closed, deletedThreads, errors };
}
