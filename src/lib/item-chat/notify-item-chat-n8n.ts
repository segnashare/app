import {
  getItemPublicAppUrl,
  getItemPublicWebUrl,
} from "@/lib/item-chat/config";
import { splitChatMessageMedia } from "@/lib/item-chat/split-chat-message-media";
import type { ItemChatConversationRow, ItemChatSource } from "@/lib/item-chat/types";

export type ItemChatThreadKind = "general" | "item" | "dispute";

const THREAD_SUBJECT: Record<ItemChatThreadKind, string> = {
  general: "Général",
  item: "Item",
  dispute: "Litige",
};

function resolveThreadKind(conversation: ItemChatConversationRow): ItemChatThreadKind {
  const disputeId =
    typeof conversation.cart_dispute_id === "string" ? conversation.cart_dispute_id.trim() : "";
  if (disputeId) return "dispute";
  const title = typeof conversation.item_title === "string" ? conversation.item_title.trim() : "";
  if (/^litige\b/i.test(title)) return "dispute";
  if (typeof conversation.item_id === "string" && conversation.item_id.trim()) return "item";
  return "general";
}

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

/**
 * URL publique joignable par n8n pour reply/bind-thread.
 * Doit pointer vers l’environnement qui partage la même DB que ce process
 * (sinon bind → `conversation_not_found`).
 */
function replyUrlForSource(_source: ItemChatSource): string {
  const override = process.env.ITEM_CHAT_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (override) return `${override}/api/internal/item-chat/reply`;

  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv === "production") {
    return "https://app.segnashare.com/api/internal/item-chat/reply";
  }
  if (vercelEnv === "preview") {
    return "https://staging.app.segnashare.com/api/internal/item-chat/reply";
  }

  // Local / NODE_ENV=production mal configuré : déduire depuis le projet Supabase.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (supabaseUrl.includes("lzdtipwxueczbwpmwyye")) {
    return "https://app.segnashare.com/api/internal/item-chat/reply";
  }
  // Staging (ptkeulrf…) ou inconnu en dev → staging (n8n cloud ne peut pas joindre localhost).
  if (
    supabaseUrl.includes("ptkeulrfiiiuiqgwhnap") ||
    process.env.NODE_ENV !== "production"
  ) {
    return "https://staging.app.segnashare.com/api/internal/item-chat/reply";
  }

  const base = (
    process.env.SEGNA_EMAIL_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_SEGNA_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.segnashare.com"
  ).replace(/\/+$/, "");
  if (base.includes("localhost") || base.includes("127.0.0.1") || base.includes("192.168.")) {
    return "https://staging.app.segnashare.com/api/internal/item-chat/reply";
  }
  return `${base}/api/internal/item-chat/reply`;
}

function resolveClientName(input: ItemChatN8nNotifyInput): {
  firstName: string | null;
  lastName: string | null;
  clientName: string;
  threadKind: ItemChatThreadKind;
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
  const threadKind = resolveThreadKind(input.conversation);
  const subject = THREAD_SUBJECT[threadKind];
  // Discord limite le nom de thread à 100 caractères.
  const threadName = `${subject} - ${clientName}`.slice(0, 100);
  return {
    firstName,
    lastName,
    clientName,
    threadKind,
    threadName,
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
  const { firstName, lastName, clientName, threadKind, threadName } = resolveClientName(input);
  const { text: bodyText, imageUrls } = splitChatMessageMedia(input.body);
  const photoUrls = imageUrls.slice(0, 10);
  const payload = {
    event: input.isFirstVisitorMessage ? "item_chat_opened" : "item_chat_message",
    conversation_id: conv.id,
    message_id: input.messageId,
    is_first_visitor_message: input.isFirstVisitorMessage,
    discord_thread_id: conv.discord_thread_id,
    body: input.body,
    /** Corps sans lignes URL image (pour Discord content). */
    body_text: bodyText,
    /** URLs images à afficher en embeds Discord (max 10). */
    photo_urls: photoUrls,
    source: input.source,
    item_id: conv.item_id,
    item_title: conv.item_title,
    item_size_label: conv.item_size_label,
    item_condition_label: conv.item_condition_label,
    cart_dispute_id:
      typeof conv.cart_dispute_id === "string" && conv.cart_dispute_id.trim()
        ? conv.cart_dispute_id.trim()
        : null,
    contact_email: conv.contact_email,
    visitor_id: conv.visitor_id,
    user_id: conv.user_id,
    client_first_name: firstName,
    client_last_name: lastName,
    client_name: clientName,
    /** `general` | `item` | `dispute` */
    thread_kind: threadKind,
    /**
     * Titre Discord thread : `Général|Item|Litige - Prénom Nom`.
     * n8n : create thread name = `{{ $json.body.thread_name }}`
     */
    thread_name: threadName,
    web_url: getItemPublicWebUrl(conv.item_id),
    app_url: getItemPublicAppUrl(conv.item_id),
    reply_url: replyUrlForSource(input.source),
    bind_thread_url: bindUrl,
    /** n8n doit POST bind_thread_url avec ce header + conversation_id + discord_thread_id. */
    bind_authorization: "Bearer <SEGNA_INTERNAL_ITEM_CHAT_SECRET>",
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
