/** Discord inbound sync + origines CORS pour le chat pièce. */

/** Sync réponses Discord → DB : suffit d’avoir le token bot. */
export function isItemChatDiscordSyncEnabled(): boolean {
  const flag = process.env.DISCORD_ITEM_CHAT_ENABLED?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
}

/** Création de fils côté app (désactivée — outbound via n8n). */
export function isItemChatDiscordEnabled(): boolean {
  const flag = process.env.DISCORD_ITEM_CHAT_ENABLED?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return Boolean(
    process.env.DISCORD_BOT_TOKEN?.trim() && process.env.DISCORD_ITEM_CHAT_CHANNEL_ID?.trim(),
  );
}

export function getDiscordBotToken(): string {
  return process.env.DISCORD_BOT_TOKEN?.trim() || "";
}

export function getDiscordItemChatChannelId(): string {
  return process.env.DISCORD_ITEM_CHAT_CHANNEL_ID?.trim() || "";
}

/** Origines autorisées (site marketing + app). */
export function getItemChatCorsOrigins(): string[] {
  const defaults = [
    "http://localhost:3000",
    "http://localhost:3002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3002",
    "https://app.segnashare.com",
    "https://staging.app.segnashare.com",
    "https://www.segnashare.com",
    "https://segnashare.com",
  ];
  const extra = [
    process.env.NEXT_PUBLIC_SEGNA_APP_URL,
    process.env.SEGNA_EMAIL_PUBLIC_BASE_URL,
    process.env.NEXT_PUBLIC_MARKETING_SITE_URL,
    process.env.ITEM_CHAT_CORS_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((raw) =>
      String(raw)
        .split(",")
        .map((s) => s.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    );
  return [...new Set([...defaults, ...extra])];
}

export function getItemPublicWebUrl(itemId: string | null | undefined): string | null {
  if (!itemId) return null;
  const base = (
    process.env.NEXT_PUBLIC_MARKETING_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.segnashare.com"
  ).replace(/\/+$/, "");
  return `${base}/catalogue/piece/${itemId}`;
}

export function getItemPublicAppUrl(itemId: string | null | undefined): string | null {
  if (!itemId) return null;
  const base = (process.env.NEXT_PUBLIC_SEGNA_APP_URL || "https://app.segnashare.com").replace(
    /\/+$/,
    "",
  );
  return `${base}/items/${itemId}`;
}
