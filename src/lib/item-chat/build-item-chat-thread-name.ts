import type { ItemChatConversationRow } from "@/lib/item-chat/types";

export type ItemChatThreadKind = "general" | "item" | "dispute";

const DISCORD_THREAD_NAME_MAX = 100;

function clip(value: string, max: number): string {
  const t = value.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  if (max <= 1) return "…";
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Extrait le n° commande compact depuis un titre litige (`… · 2A0FDE49`). */
export function extractOrderCompactFromDisputeTitle(title: string | null | undefined): string | null {
  const t = typeof title === "string" ? title.trim() : "";
  if (!t) return null;
  const m = t.match(/·\s*([A-Z0-9]{6,12})\s*$/i);
  return m?.[1] ? m[1].toUpperCase() : null;
}

export function resolveItemChatThreadKind(
  conversation: Pick<ItemChatConversationRow, "item_id" | "item_title" | "cart_dispute_id">,
): ItemChatThreadKind {
  const disputeId =
    typeof conversation.cart_dispute_id === "string" ? conversation.cart_dispute_id.trim() : "";
  if (disputeId) return "dispute";
  const title = typeof conversation.item_title === "string" ? conversation.item_title.trim() : "";
  if (/^litige\b/i.test(title)) return "dispute";
  if (typeof conversation.item_id === "string" && conversation.item_id.trim()) return "item";
  return "general";
}

/**
 * Titre Discord / libellé conversation :
 * - `Général · Prénom Nom`
 * - `Item · Nom article · Prénom Nom`
 * - `Litige · 2A0FDE49 · Prénom Nom`
 */
export function buildItemChatThreadName(input: {
  conversation: Pick<ItemChatConversationRow, "item_id" | "item_title" | "cart_dispute_id">;
  clientName: string;
}): { threadKind: ItemChatThreadKind; threadName: string } {
  const clientName = input.clientName.trim() || "Visiteur";
  const threadKind = resolveItemChatThreadKind(input.conversation);
  const title = typeof input.conversation.item_title === "string"
    ? input.conversation.item_title.trim()
    : "";

  if (threadKind === "dispute") {
    const order =
      extractOrderCompactFromDisputeTitle(title) ||
      (typeof input.conversation.cart_dispute_id === "string"
        ? input.conversation.cart_dispute_id.replace(/-/g, "").slice(0, 8).toUpperCase()
        : "LITIGE");
    return {
      threadKind,
      threadName: clip(`Litige · ${order} · ${clientName}`, DISCORD_THREAD_NAME_MAX),
    };
  }

  if (threadKind === "item") {
    const itemLabel = title && !/^question\b/i.test(title) ? title : "Article";
    // Réserve de la place pour préfixe + client.
    const budget = DISCORD_THREAD_NAME_MAX - `Item ·  · ${clientName}`.length;
    const itemPart = clip(itemLabel, Math.max(12, budget));
    return {
      threadKind,
      threadName: clip(`Item · ${itemPart} · ${clientName}`, DISCORD_THREAD_NAME_MAX),
    };
  }

  return {
    threadKind,
    threadName: clip(`Général · ${clientName}`, DISCORD_THREAD_NAME_MAX),
  };
}
