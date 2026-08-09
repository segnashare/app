type ChatMessageLike = {
  id: string;
  role: "visitor" | "staff" | "system";
  body: string;
  createdAt: string;
  staffDisplayName?: string | null;
  staffAvatarUrl?: string | null;
};

/** Délai mini avant d’afficher l’ack bot (expérience « en train d’écrire »). */
export const ITEM_CHAT_TYPING_MIN_MS = 1_100;
/** Garde un temps de frappe même si le réseau est très rapide. */
export const ITEM_CHAT_TYPING_AFTER_NETWORK_MS = 750;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeOptimisticVisitorMessage(body: string): ChatMessageLike {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role: "visitor",
    body,
    createdAt: new Date().toISOString(),
  };
}

/** Remplace un message optimiste par la version serveur (sans dupliquer). */
export function replaceOptimisticVisitorMessage<T extends ChatMessageLike>(
  prev: T[],
  optimisticId: string,
  serverMessage: T | undefined,
): T[] {
  const withoutLocal = prev.filter((m) => m.id !== optimisticId);
  if (!serverMessage) return withoutLocal;
  if (withoutLocal.some((m) => m.id === serverMessage.id)) return withoutLocal;
  return [...withoutLocal, serverMessage];
}

export async function waitForTypingReveal(startedAtMs: number): Promise<void> {
  const elapsed = Date.now() - startedAtMs;
  const wait = Math.max(ITEM_CHAT_TYPING_MIN_MS - elapsed, ITEM_CHAT_TYPING_AFTER_NETWORK_MS);
  if (wait > 0) await sleep(wait);
}

function isOptimisticChatMessageId(id: string): boolean {
  return id.startsWith("local-");
}

/** Nouveaux messages staff/system absents du fil affiché (réponses Discord, etc.). */
export function findNewInboundChatMessages<T extends ChatMessageLike>(
  prev: T[],
  next: T[],
): T[] {
  const prevIds = new Set(prev.map((m) => m.id));
  return next.filter(
    (m) => (m.role === "staff" || m.role === "system") && !prevIds.has(m.id),
  );
}

/**
 * True si le fil affiché est le même thread que `next` (continuité),
 * pour éviter l’effet typing à l’ouverture d’une autre conversation.
 */
export function isSameChatThreadContinuation<T extends ChatMessageLike>(
  prev: T[],
  next: T[],
): boolean {
  if (prev.length === 0) return false;
  const nextIds = new Set(next.map((m) => m.id));
  return prev.some((m) => nextIds.has(m.id) || isOptimisticChatMessageId(m.id));
}
