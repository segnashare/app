const STORAGE_KEY = "segna_item_chat_v1";

export type ItemChatLocalState = {
  visitorId: string;
  /** Conversation active (dernière ouverte). */
  conversationId: string | null;
  /** lastReadAt ISO par conversationId */
  lastReadByConversation: Record<string, string>;
  contactEmail: string | null;
};

function emptyState(): ItemChatLocalState {
  return {
    visitorId: crypto.randomUUID(),
    conversationId: null,
    lastReadByConversation: {},
    contactEmail: null,
  };
}

export function loadItemChatLocalState(): ItemChatLocalState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = emptyState();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<ItemChatLocalState>;
    const visitorId =
      typeof parsed.visitorId === "string" && parsed.visitorId.length > 10
        ? parsed.visitorId
        : crypto.randomUUID();
    const state: ItemChatLocalState = {
      visitorId,
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      lastReadByConversation:
        parsed.lastReadByConversation && typeof parsed.lastReadByConversation === "object"
          ? parsed.lastReadByConversation
          : {},
      contactEmail: typeof parsed.contactEmail === "string" ? parsed.contactEmail : null,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  } catch {
    const fresh = emptyState();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      /* ignore */
    }
    return fresh;
  }
}

export function saveItemChatLocalState(state: ItemChatLocalState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export type OpenItemChatDetail = {
  itemId: string;
  itemTitle?: string | null;
  itemSizeLabel?: string | null;
  itemConditionLabel?: string | null;
};

export const ITEM_CHAT_OPEN_EVENT = "segna:item-chat-open";

/** Ouvre le panneau liste (aide / assistance sans pièce liée). */
export const ITEM_CHAT_OPEN_PANEL_EVENT = "segna:item-chat-open-panel";

export function openItemChat(detail: OpenItemChatDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ITEM_CHAT_OPEN_EVENT, { detail }));
}

export function openItemChatPanel(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ITEM_CHAT_OPEN_PANEL_EVENT));
}
