import type { SupabaseClient } from "@supabase/supabase-js";

import {
  memberCartDisputeCategoryLabel,
  type MemberCartDisputeReportKind,
} from "@/lib/disputes/member-cart-dispute-categories";
import {
  appendVisitorMessage,
  openOrCreateConversation,
} from "@/lib/item-chat/service";
import type { ItemChatConversationRow, ItemChatSource } from "@/lib/item-chat/types";
import { ITEM_CHAT_BODY_MAX } from "@/lib/item-chat/types";

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function buildDisputeChatBody(input: {
  reportKind: MemberCartDisputeReportKind;
  category: string;
  details: string;
  photoUrls: string[];
  updated: boolean;
}): string {
  const categoryLabel = memberCartDisputeCategoryLabel(input.category, input.reportKind);
  const kindLabel =
    input.reportKind === "reception" ? "Litige à la réception" : "Litige emprunt";
  const header = input.updated
    ? `[Mise à jour — ${kindLabel}]`
    : `[Nouveau — ${kindLabel}]`;
  const urls = input.photoUrls.map((u) => u.trim()).filter(Boolean);
  const photoBlock =
    urls.length > 0
      ? `\nPhotos jointes (${urls.length}) :\n${urls.join("\n")}`
      : "\nAucune photo jointe";
  const body = `${header}\nType : ${categoryLabel}${photoBlock}\n\n${input.details.trim()}`;
  if (body.length <= ITEM_CHAT_BODY_MAX) return body;
  return `${body.slice(0, ITEM_CHAT_BODY_MAX - 1)}…`;
}

async function softLinkDisputeConversation(
  admin: SupabaseClient,
  disputeId: string,
  conversationId: string,
): Promise<void> {
  const { error: e1 } = await admin
    .from("item_chat_conversations")
    .update({ cart_dispute_id: disputeId })
    .eq("id", conversationId);
  if (e1) {
    console.warn("[ensure-dispute-item-chat] link cart_dispute_id", e1.message);
  }
  const { error: e2 } = await admin
    .from("cart_disputes")
    .update({ conversation_id: conversationId, updated_at: new Date().toISOString() })
    .eq("id", disputeId);
  if (e2) {
    console.warn("[ensure-dispute-item-chat] link conversation_id", e2.message);
  }
}

/**
 * Ouvre (ou réutilise) une conversation chatbot liée au litige, avec le message membre.
 * Best-effort : ne fait pas échouer l’ouverture du litige si le chat échoue.
 */
export async function ensureDisputeItemChat(params: {
  admin: SupabaseClient;
  cartId: string;
  disputeId: string;
  existingConversationId: string | null;
  userId: string;
  userEmail: string | null;
  reportKind: MemberCartDisputeReportKind;
  category: string;
  details: string;
  /** URLs signées affichables (chat + unfurl Discord). */
  photoUrls?: string[];
  updated: boolean;
  source?: ItemChatSource;
}): Promise<string | null> {
  const source = params.source ?? "app";
  const orderCompact = formatOrderNumberCompact(params.cartId);
  const title =
    params.reportKind === "reception"
      ? `Litige réception · ${orderCompact}`
      : `Litige emprunt · ${orderCompact}`;
  const ackBody =
    params.reportKind === "reception"
      ? "Merci, on a bien reçu ta déclaration de litige. L’équipe Segna te répond très vite ici."
      : "Merci, on a bien reçu ton signalement. L’équipe Segna te répond très vite ici.";

  try {
    let conversationId = params.existingConversationId?.trim() || null;
    let conversation: ItemChatConversationRow | null = null;

    if (conversationId) {
      await params.admin
        .from("item_chat_conversations")
        .update({
          status: "open",
          item_title: title,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
      const { data } = await params.admin
        .from("item_chat_conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
      conversation = data ? (data as ItemChatConversationRow) : null;
    }

    if (!conversation) {
      const visitorId = crypto.randomUUID();
      conversation = await openOrCreateConversation({
        admin: params.admin,
        itemId: null,
        visitorId,
        source,
        contactEmail: params.userEmail,
        userId: params.userId,
        itemTitle: title,
        itemSizeLabel: null,
        itemConditionLabel: null,
        forceNew: true,
      });
      conversationId = conversation.id;
    }

    if (conversationId) {
      await softLinkDisputeConversation(params.admin, params.disputeId, conversationId);
    }

    const body = buildDisputeChatBody({
      reportKind: params.reportKind,
      category: params.category,
      details: params.details,
      photoUrls: params.photoUrls ?? [],
      updated: params.updated,
    });

    await appendVisitorMessage({
      admin: params.admin,
      conversation,
      body,
      source,
      ackBody: params.updated ? null : ackBody,
    });

    return conversationId;
  } catch (err) {
    console.error(
      "[ensure-dispute-item-chat]",
      err instanceof Error ? err.message : String(err),
    );
    return params.existingConversationId;
  }
}
