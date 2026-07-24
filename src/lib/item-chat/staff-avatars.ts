/** Avatars staff locaux (override Discord / fallback). */
const STAFF_AVATARS: Record<string, string> = {
  guilhem: "/brand/staff/guilhem.jpg",
};

/** Icône Segna carrée pour le chatbot (tient dans le cercle). */
export const CHATBOT_AVATAR_URL = "/icon.png";

export function resolveStaffAvatarUrl(
  displayName: string | null | undefined,
  remoteUrl?: string | null,
): string | null {
  const key = String(displayName ?? "")
    .trim()
    .split(/\s+/)[0]
    ?.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (key && STAFF_AVATARS[key]) return STAFF_AVATARS[key];
  const remote = typeof remoteUrl === "string" ? remoteUrl.trim() : "";
  // Ne pas servir les avatars Discord embed (souvent bloqués / peu fiables).
  if (remote.includes("cdn.discordapp.com") || remote.includes("discord.com")) {
    return null;
  }
  return remote || null;
}

/** Avatar liste / header : photo staff locale, sinon logo Segna. */
export function resolveConversationAvatarUrl(
  displayName: string | null | undefined,
  remoteUrl?: string | null,
): string {
  return resolveStaffAvatarUrl(displayName, remoteUrl) || CHATBOT_AVATAR_URL;
}
