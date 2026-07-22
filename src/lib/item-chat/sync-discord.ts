import type { SupabaseClient } from "@supabase/supabase-js";

import {
  discordFetchThreadMessagesAfter,
  discordGetBotUserId,
  discordStaffProfileFromAuthor,
} from "@/lib/item-chat/discord";
import { isItemChatDiscordSyncEnabled } from "@/lib/item-chat/config";
import { ensureStaffJoinedEvent } from "@/lib/item-chat/service";
import type { ItemChatConversationRow } from "@/lib/item-chat/types";

type Admin = SupabaseClient;

function asConv(row: unknown): ItemChatConversationRow {
  return row as ItemChatConversationRow;
}

async function syncOneConversation(
  admin: Admin,
  conv: ItemChatConversationRow,
  botUserId: string | null,
): Promise<{ inserted: number; error: boolean }> {
  if (!conv.discord_thread_id) return { inserted: 0, error: false };
  let inserted = 0;
  try {
    const messages = await discordFetchThreadMessagesAfter({
      threadId: conv.discord_thread_id,
      afterMessageId: conv.discord_last_message_id,
    });

    let latestId = conv.discord_last_message_id;
    for (const msg of messages) {
      if (!msg.id) continue;
      latestId = msg.id;
      if (msg.author?.bot) continue;
      if (botUserId && msg.author?.id === botUserId) continue;
      const body = (msg.content || "").trim();
      if (!body) continue;

      const profile = discordStaffProfileFromAuthor(msg.author);
      const createdAt = msg.timestamp || new Date().toISOString();
      if (profile) {
        await ensureStaffJoinedEvent({
          admin,
          conversationId: conv.id,
          staffDisplayName: profile.displayName,
          staffAvatarUrl: profile.avatarUrl,
          beforeIso: createdAt,
        });
      }
      const { error } = await admin.from("item_chat_messages" as never).insert({
        conversation_id: conv.id,
        role: "staff",
        body: body.slice(0, 4000),
        discord_message_id: msg.id,
        staff_display_name: profile?.displayName ?? null,
        staff_avatar_url: profile?.avatarUrl ?? null,
        created_at: createdAt,
      } as never);

      if (error) {
        if (!/duplicate|unique/i.test(error.message || "")) {
          console.error("[item-chat/sync] insert failed", error.message);
          return { inserted, error: true };
        }
        continue;
      }
      inserted += 1;
      await admin
        .from("item_chat_conversations" as never)
        .update({
          last_message_at: msg.timestamp || new Date().toISOString(),
          discord_last_message_id: msg.id,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", conv.id);
    }

    if (latestId && latestId !== conv.discord_last_message_id) {
      await admin
        .from("item_chat_conversations" as never)
        .update({
          discord_last_message_id: latestId,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", conv.id);
    }
    return { inserted, error: false };
  } catch (e) {
    console.error("[item-chat/sync] conversation failed", conv.id, e);
    return { inserted, error: true };
  }
}

/** Sync une conversation (appelé au refresh messages côté client). */
export async function syncItemChatDiscordInboundForConversation(
  admin: Admin,
  conversation: ItemChatConversationRow,
): Promise<number> {
  if (!isItemChatDiscordSyncEnabled() || !conversation.discord_thread_id) return 0;
  const botUserId = await discordGetBotUserId();
  const result = await syncOneConversation(admin, conversation, botUserId);
  return result.inserted;
}

/**
 * Pour chaque conversation ouverte avec thread Discord, importe les messages
 * staff (non-bot) absents de la base.
 */
export async function syncItemChatDiscordInbound(admin: Admin): Promise<{
  scanned: number;
  inserted: number;
  errors: number;
}> {
  if (!isItemChatDiscordSyncEnabled()) {
    return { scanned: 0, inserted: 0, errors: 0 };
  }

  const botUserId = await discordGetBotUserId();
  const { data } = await admin
    .from("item_chat_conversations" as never)
    .select("*")
    .eq("status", "open")
    .not("discord_thread_id", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(40);

  const rows = Array.isArray(data) ? data.map(asConv) : [];
  let inserted = 0;
  let errors = 0;

  for (const conv of rows) {
    const result = await syncOneConversation(admin, conv, botUserId);
    inserted += result.inserted;
    if (result.error) errors += 1;
  }

  return { scanned: rows.length, inserted, errors };
}
