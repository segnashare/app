import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyItemChatN8n } from "@/lib/item-chat/notify-item-chat-n8n";
import type {
  ItemChatConversationDto,
  ItemChatConversationRow,
  ItemChatMessageDto,
  ItemChatMessageRow,
  ItemChatSource,
} from "@/lib/item-chat/types";
import { ITEM_CHAT_BODY_MAX, ITEM_CHAT_BODY_MIN, UUID_RE } from "@/lib/item-chat/types";

type Admin = SupabaseClient;

function asConv(row: unknown): ItemChatConversationRow {
  return row as ItemChatConversationRow;
}

function asMsg(row: unknown): ItemChatMessageRow {
  return row as ItemChatMessageRow;
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t || t.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t;
}

export function normalizeMessageBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length < ITEM_CHAT_BODY_MIN || t.length > ITEM_CHAT_BODY_MAX) return null;
  return t;
}

export function toMessageDto(row: ItemChatMessageRow): ItemChatMessageDto {
  return {
    id: row.id,
    role: row.role,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function countUnreadStaff(
  admin: Admin,
  conversationId: string,
  lastReadAt: string | null,
): Promise<number> {
  let q = admin
    .from("item_chat_messages" as never)
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("role", "staff");
  if (lastReadAt) {
    q = q.gt("created_at", lastReadAt);
  }
  const { count } = await q;
  return typeof count === "number" ? count : 0;
}

export async function countVisitorMessages(
  admin: Admin,
  conversationId: string,
): Promise<number> {
  const { count } = await admin
    .from("item_chat_messages" as never)
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("role", "visitor");
  return typeof count === "number" ? count : 0;
}

export async function toConversationDto(
  admin: Admin,
  row: ItemChatConversationRow,
): Promise<ItemChatConversationDto> {
  const [unreadStaffCount, visitorMessageCount] = await Promise.all([
    countUnreadStaff(admin, row.id, row.last_read_at),
    countVisitorMessages(admin, row.id),
  ]);
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    itemSizeLabel: row.item_size_label,
    itemConditionLabel: row.item_condition_label,
    contactEmail: row.contact_email,
    status: row.status,
    lastMessageAt: row.last_message_at,
    lastReadAt: row.last_read_at,
    unreadStaffCount,
    hasVisitorMessage: visitorMessageCount > 0,
    usefulnessPromptedAt: row.usefulness_prompted_at ?? null,
    usefulnessRating: row.usefulness_rating ?? null,
  };
}

export async function findOpenConversation(params: {
  admin: Admin;
  itemId: string | null;
  visitorId: string;
  userId?: string | null;
}): Promise<ItemChatConversationRow | null> {
  const { admin, itemId, visitorId, userId } = params;

  if (userId) {
    const base = admin
      .from("item_chat_conversations" as never)
      .select("*")
      .eq("status", "open")
      .eq("user_id", userId);
    const { data } = await (itemId ? base.eq("item_id", itemId) : base.is("item_id", null))
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return asConv(data);
  }

  const base = admin
    .from("item_chat_conversations" as never)
    .select("*")
    .eq("status", "open")
    .eq("visitor_id", visitorId);
  const { data } = await (itemId ? base.eq("item_id", itemId) : base.is("item_id", null))
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? asConv(data) : null;
}

export async function getConversationForVisitor(params: {
  admin: Admin;
  conversationId: string;
  visitorId: string;
  userId?: string | null;
}): Promise<ItemChatConversationRow | null> {
  const { admin, conversationId, visitorId, userId } = params;
  if (!UUID_RE.test(conversationId)) return null;
  const { data } = await admin
    .from("item_chat_conversations" as never)
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) return null;
  const row = asConv(data);
  if (userId && row.user_id === userId) return row;
  if (row.visitor_id === visitorId) return row;
  return null;
}

export async function listMessages(
  admin: Admin,
  conversationId: string,
): Promise<ItemChatMessageDto[]> {
  const { data } = await admin
    .from("item_chat_messages" as never)
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  const rows = Array.isArray(data) ? data.map(asMsg) : [];
  return rows.map(toMessageDto);
}

export async function openOrCreateConversation(params: {
  admin: Admin;
  itemId: string | null;
  visitorId: string;
  source: ItemChatSource;
  contactEmail: string | null;
  userId: string | null;
  itemTitle: string | null;
  itemSizeLabel: string | null;
  itemConditionLabel: string | null;
  forceNew?: boolean;
}): Promise<ItemChatConversationRow> {
  if (!params.forceNew) {
    const existing = await findOpenConversation({
      admin: params.admin,
      itemId: params.itemId,
      visitorId: params.visitorId,
      userId: params.userId,
    });
    if (existing) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (params.contactEmail && !existing.contact_email) patch.contact_email = params.contactEmail;
      if (params.userId && !existing.user_id) patch.user_id = params.userId;
      if (params.itemTitle) patch.item_title = params.itemTitle;
      if (params.itemSizeLabel) patch.item_size_label = params.itemSizeLabel;
      if (params.itemConditionLabel) patch.item_condition_label = params.itemConditionLabel;
      const { data } = await params.admin
        .from("item_chat_conversations" as never)
        .update(patch as never)
        .eq("id", existing.id)
        .select("*")
        .single();
      return data ? asConv(data) : existing;
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await params.admin
    .from("item_chat_conversations" as never)
    .insert({
      item_id: params.itemId,
      visitor_id: params.visitorId,
      user_id: params.userId,
      contact_email: params.contactEmail,
      source: params.source,
      status: "open",
      item_title: params.itemTitle || (params.itemId ? null : "Question générale"),
      item_size_label: params.itemSizeLabel,
      item_condition_label: params.itemConditionLabel,
      last_message_at: now,
      created_at: now,
      updated_at: now,
    } as never)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Impossible de créer la conversation");
  }
  return asConv(data);
}

export async function appendVisitorMessage(params: {
  admin: Admin;
  conversation: ItemChatConversationRow;
  body: string;
  source: ItemChatSource;
}): Promise<{
  message: ItemChatMessageDto;
  ackMessage?: ItemChatMessageDto;
  conversation: ItemChatConversationRow;
}> {
  const { admin, conversation, body, source } = params;
  const now = new Date().toISOString();

  const { count: priorVisitorCount } = await admin
    .from("item_chat_messages" as never)
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("role", "visitor");
  const isFirstVisitorMessage = !priorVisitorCount;

  const { data: msgData, error: msgError } = await admin
    .from("item_chat_messages" as never)
    .insert({
      conversation_id: conversation.id,
      role: "visitor",
      body,
      discord_message_id: null,
      created_at: now,
    } as never)
    .select("*")
    .single();
  if (msgError || !msgData) {
    throw new Error(msgError?.message || "Impossible d’enregistrer le message");
  }

  const visitorMessage = toMessageDto(asMsg(msgData));

  let ackMessage: ItemChatMessageDto | undefined;
  let lastAt = now;
  if (isFirstVisitorMessage) {
    const ackAt = new Date(Date.parse(now) + 1).toISOString();
    const { data: ackData } = await admin
      .from("item_chat_messages" as never)
      .insert({
        conversation_id: conversation.id,
        role: "staff",
        body: "Merci, on a bien reçu ta question. On te répond très vite.",
        discord_message_id: null,
        created_at: ackAt,
      } as never)
      .select("*")
      .single();
    if (ackData) {
      ackMessage = toMessageDto(asMsg(ackData));
      lastAt = ackAt;
    }
  }

  const { data: convData } = await admin
    .from("item_chat_conversations" as never)
    .update({
      last_message_at: lastAt,
      updated_at: lastAt,
      // Nouvelle activité client → annule le cycle feedback / suppression Discord
      usefulness_prompted_at: null,
      usefulness_rating: null,
    } as never)
    .eq("id", conversation.id)
    .select("*")
    .single();

  const updatedConversation = convData ? asConv(convData) : conversation;

  // n8n → Discord (ne bloque pas l’UX si le webhook échoue)
  await notifyItemChatN8n({
    conversation: updatedConversation,
    messageId: visitorMessage.id,
    body,
    source,
    isFirstVisitorMessage,
  });

  return {
    message: visitorMessage,
    ackMessage,
    conversation: updatedConversation,
  };
}

export async function appendStaffMessage(params: {
  admin: Admin;
  conversationId: string;
  body: string;
  externalId?: string | null;
}): Promise<{ message: ItemChatMessageDto; conversation: ItemChatConversationRow } | null> {
  const { admin, conversationId, body, externalId } = params;
  if (!UUID_RE.test(conversationId)) return null;

  const { data: convRaw } = await admin
    .from("item_chat_conversations" as never)
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (!convRaw) return null;
  const conversation = asConv(convRaw);

  const now = new Date().toISOString();
  const insertRow: Record<string, unknown> = {
    conversation_id: conversation.id,
    role: "staff",
    body,
    created_at: now,
  };
  if (externalId) insertRow.discord_message_id = externalId;

  const { data: msgData, error: msgError } = await admin
    .from("item_chat_messages" as never)
    .insert(insertRow as never)
    .select("*")
    .single();

  if (msgError) {
    // Idempotence si external_id déjà vu
    if (externalId && /duplicate|unique/i.test(msgError.message)) {
      const { data: existing } = await admin
        .from("item_chat_messages" as never)
        .select("*")
        .eq("discord_message_id", externalId)
        .maybeSingle();
      if (existing) {
        return { message: toMessageDto(asMsg(existing)), conversation };
      }
    }
    throw new Error(msgError.message || "Impossible d’enregistrer la réponse staff");
  }
  if (!msgData) return null;

  const { data: convData } = await admin
    .from("item_chat_conversations" as never)
    .update({
      last_message_at: now,
      updated_at: now,
    } as never)
    .eq("id", conversation.id)
    .select("*")
    .single();

  return {
    message: toMessageDto(asMsg(msgData)),
    conversation: convData ? asConv(convData) : conversation,
  };
}

export async function markConversationRead(params: {
  admin: Admin;
  conversationId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await params.admin
    .from("item_chat_conversations" as never)
    .update({ last_read_at: now, updated_at: now } as never)
    .eq("id", params.conversationId);
}

/** Enregistre le fil Discord créé par n8n pour les messages suivants. */
export async function bindDiscordThread(params: {
  admin: Admin;
  conversationId: string;
  discordThreadId: string;
}): Promise<ItemChatConversationRow | null> {
  const { admin, conversationId, discordThreadId } = params;
  if (!UUID_RE.test(conversationId) || !discordThreadId.trim()) return null;
  const now = new Date().toISOString();
  const { data } = await admin
    .from("item_chat_conversations" as never)
    .update({
      discord_thread_id: discordThreadId.trim(),
      updated_at: now,
    } as never)
    .eq("id", conversationId)
    .select("*")
    .maybeSingle();
  return data ? asConv(data) : null;
}

export async function recordUsefulnessRating(params: {
  admin: Admin;
  conversation: ItemChatConversationRow;
  rating: "yes" | "no";
}): Promise<{
  conversation: ItemChatConversationRow;
  answerMessage: ItemChatMessageDto;
  thankYouMessage: ItemChatMessageDto;
} | null> {
  const { admin, conversation, rating } = params;
  if (conversation.status !== "open") return null;
  if (!conversation.usefulness_prompted_at || conversation.usefulness_rating) return null;

  const { ITEM_CHAT_USEFULNESS_THANKS_BODY } = await import(
    "@/lib/item-chat/lifecycle-constants"
  );

  const now = new Date().toISOString();
  const answerBody = rating === "yes" ? "Oui" : "Non";
  const { data: answerData, error: answerError } = await admin
    .from("item_chat_messages" as never)
    .insert({
      conversation_id: conversation.id,
      role: "visitor",
      body: answerBody,
      discord_message_id: null,
      created_at: now,
    } as never)
    .select("*")
    .single();
  if (answerError || !answerData) return null;

  const thanksAt = new Date(Date.parse(now) + 1).toISOString();
  const { data: thanksData, error: thanksError } = await admin
    .from("item_chat_messages" as never)
    .insert({
      conversation_id: conversation.id,
      role: "system",
      body: ITEM_CHAT_USEFULNESS_THANKS_BODY,
      discord_message_id: null,
      created_at: thanksAt,
    } as never)
    .select("*")
    .single();
  if (thanksError || !thanksData) return null;

  const { data: convData } = await admin
    .from("item_chat_conversations" as never)
    .update({
      usefulness_rating: rating,
      last_message_at: thanksAt,
      updated_at: thanksAt,
    } as never)
    .eq("id", conversation.id)
    .select("*")
    .single();
  if (!convData) return null;

  return {
    conversation: asConv(convData),
    answerMessage: toMessageDto(asMsg(answerData)),
    thankYouMessage: toMessageDto(asMsg(thanksData)),
  };
}

export async function claimVisitorConversations(params: {
  admin: Admin;
  visitorId: string;
  userId: string;
  email: string | null;
}): Promise<number> {
  const patch: Record<string, unknown> = {
    user_id: params.userId,
    updated_at: new Date().toISOString(),
  };
  if (params.email) patch.contact_email = params.email;
  const { data } = await params.admin
    .from("item_chat_conversations" as never)
    .update(patch as never)
    .eq("visitor_id", params.visitorId)
    .is("user_id", null)
    .select("id");
  return Array.isArray(data) ? data.length : 0;
}

export async function listConversationsForIdentity(params: {
  admin: Admin;
  visitorId: string;
  userId: string | null;
}): Promise<ItemChatConversationDto[]> {
  let q = params.admin
    .from("item_chat_conversations" as never)
    .select("*")
    .order("last_message_at", { ascending: false })
    .limit(20);
  if (params.userId) {
    q = q.or(`user_id.eq.${params.userId},visitor_id.eq.${params.visitorId}`);
  } else {
    q = q.eq("visitor_id", params.visitorId);
  }
  const { data } = await q;
  const rows = Array.isArray(data) ? data.map(asConv) : [];
  return Promise.all(rows.map((r) => toConversationDto(params.admin, r)));
}
