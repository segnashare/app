import {
  getItemPublicAppUrl,
  getItemPublicWebUrl,
} from "@/lib/item-chat/config";
import type { ItemChatConversationRow, ItemChatSource } from "@/lib/item-chat/types";

export type ItemChatN8nNotifyInput = {
  conversation: ItemChatConversationRow;
  messageId: string;
  body: string;
  source: ItemChatSource;
  isFirstVisitorMessage: boolean;
  /** Prénom + nom membre (si connecté). */
  clientFirstName?: string | null;
  clientLastName?: string | null;
};

export type ItemChatN8nNotifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_url" | "http_error" | "network_error"; detail?: string };

/** Tolère un commentaire inline dans `.env` (ex. `https://…/webhook/xxx #prod`). */
function readItemChatWebhookUrl(): string {
  const raw = process.env.N8N_ITEM_CHAT_WEBHOOK_URL?.trim() ?? "";
  if (!raw) return "";
  return raw.split("#")[0]?.trim() ?? "";
}

function readItemChatWebhookSecret(): string {
  return process.env.N8N_ITEM_CHAT_WEBHOOK_SECRET?.trim() ?? "";
}

function replyUrlForSource(source: ItemChatSource): string {
  const override = process.env.ITEM_CHAT_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (override) return `${override}/api/internal/item-chat/reply`;

  if (source === "web") {
    const base = (
      process.env.NEXT_PUBLIC_MARKETING_SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://www.segnashare.com"
    ).replace(/\/+$/, "");
    return `${base}/api/internal/item-chat/reply`;
  }
  const base = (
    process.env.SEGNA_EMAIL_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_SEGNA_APP_URL ||
    "https://app.segnashare.com"
  ).replace(/\/+$/, "");
  return `${base}/api/internal/item-chat/reply`;
}

function resolveClientName(input: ItemChatN8nNotifyInput): {
  firstName: string | null;
  lastName: string | null;
  clientName: string;
  threadName: string;
} {
  const firstName =
    typeof input.clientFirstName === "string" && input.clientFirstName.trim()
      ? input.clientFirstName.trim()
      : null;
  const lastName =
    typeof input.clientLastName === "string" && input.clientLastName.trim()
      ? input.clientLastName.trim()
      : null;
  const fromUser = [firstName, lastName].filter(Boolean).join(" ").trim();
  const email = input.conversation.contact_email?.trim() || "";
  const emailLocal = email.includes("@") ? email.split("@")[0]!.trim() : email;
  const clientName = fromUser || emailLocal || "Visiteur";
  return {
    firstName,
    lastName,
    clientName,
    threadName: clientName.slice(0, 100),
  };
}

/**
 * Déclenche le workflow n8n (`N8N_ITEM_CHAT_WEBHOOK_URL`) après un message visitor chat pièce.
 * À await côté API pour éviter que Next coupe le fetch.
 */
export async function notifyItemChatN8n(
  input: ItemChatN8nNotifyInput,
): Promise<ItemChatN8nNotifyResult> {
  const url = readItemChatWebhookUrl();
  if (!url) {
    console.error("[n8n/item-chat] N8N_ITEM_CHAT_WEBHOOK_URL is not set");
    return { ok: false, reason: "missing_url" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = readItemChatWebhookSecret();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const conv = input.conversation;
  const bindUrl = replyUrlForSource(input.source).replace(/\/reply$/, "/bind-thread");
  const { firstName, lastName, clientName, threadName } = resolveClientName(input);
  const payload = {
    event: input.isFirstVisitorMessage ? "item_chat_opened" : "item_chat_message",
    conversation_id: conv.id,
    message_id: input.messageId,
    is_first_visitor_message: input.isFirstVisitorMessage,
    discord_thread_id: conv.discord_thread_id,
    body: input.body,
    source: input.source,
    item_id: conv.item_id,
    item_title: conv.item_title,
    item_size_label: conv.item_size_label,
    item_condition_label: conv.item_condition_label,
    contact_email: conv.contact_email,
    visitor_id: conv.visitor_id,
    user_id: conv.user_id,
    client_first_name: firstName,
    client_last_name: lastName,
    client_name: clientName,
    /** Titre Discord thread (nom client). n8n : Options → Thread Name = `{{ $json.body.thread_name }}` */
    thread_name: threadName,
    web_url: getItemPublicWebUrl(conv.item_id),
    app_url: getItemPublicAppUrl(conv.item_id),
    reply_url: replyUrlForSource(input.source),
    bind_thread_url: bindUrl,
    sent_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = `${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
      console.warn("[n8n/item-chat] webhook HTTP", detail);
      return { ok: false, reason: "http_error", detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[n8n/item-chat] webhook failed", detail);
    return { ok: false, reason: "network_error", detail };
  }
}
