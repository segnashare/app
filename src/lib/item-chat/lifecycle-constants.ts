/** Prompt affiché au client après inactivité. */
export const ITEM_CHAT_USEFULNESS_PROMPT_BODY =
  "Est-ce que cette discussion t'a été utile ?";

export const ITEM_CHAT_USEFULNESS_THANKS_BODY = "Merci pour ton retour !";

export type ItemChatUsefulnessRating = "yes" | "no";

function hoursFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Délai sans message avant le prompt utilité (défaut 12h). */
export function itemChatUsefulnessIdleMs(): number {
  return hoursFromEnv("ITEM_CHAT_USEFULNESS_IDLE_HOURS", 12) * 3_600_000;
}

/** Délai après le prompt avant suppression du fil Discord (défaut 12h). */
export function itemChatDiscordDeleteAfterPromptMs(): number {
  return hoursFromEnv("ITEM_CHAT_DISCORD_DELETE_HOURS", 12) * 3_600_000;
}
