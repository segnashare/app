import "server-only";

import { sendExpoPushToUser } from "@/lib/notifications/expo-push-send";
import { NotificationKind } from "@/lib/notifications/kinds";
import type { SupabaseClient } from "@supabase/supabase-js";

const PREVIEW_CHARS = 10;

/** Aperçu push : 10 premiers caractères du message + « ... ». */
export function itemChatStaffPushBodyPreview(body: string): string {
  const t = body.trim().replace(/\s+/g, " ");
  if (!t) return "";
  if (t.length <= PREVIEW_CHARS) return t;
  return `${t.slice(0, PREVIEW_CHARS)}...`;
}

export function itemChatStaffPushTitle(staffDisplayName?: string | null): string {
  const name = typeof staffDisplayName === "string" ? staffDisplayName.trim() : "";
  return name || "Chatbot";
}

/**
 * Push membre pour une réponse staff chatbot (Discord / n8n).
 * Best-effort : ne doit pas faire échouer l’écriture du message.
 */
export async function notifyItemChatStaffMessagePush(params: {
  admin: SupabaseClient;
  userId: string | null | undefined;
  conversationId: string;
  messageId: string;
  body: string;
  staffDisplayName?: string | null;
}): Promise<void> {
  const userId = typeof params.userId === "string" ? params.userId.trim() : "";
  if (!userId) return;

  const body = itemChatStaffPushBodyPreview(params.body);
  if (!body) return;

  const title = itemChatStaffPushTitle(params.staffDisplayName);
  const conversationId = params.conversationId.trim();

  try {
    await sendExpoPushToUser(params.admin, userId, {
      title,
      body,
      data: {
        kind: NotificationKind.itemChatStaffMessage,
        conversation_id: conversationId,
        message_id: params.messageId,
        url: `segna://chat?c=${encodeURIComponent(conversationId)}`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[item-chat] staff push failed", msg);
  }
}
