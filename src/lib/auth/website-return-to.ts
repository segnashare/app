/**
 * Origines autorisées pour `return_to` après OAuth (checkout website).
 * Évite les open redirects hors Segna / localhost.
 */
export function isAllowedWebsiteReturnTo(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "segnashare.com" || host.endsWith(".segnashare.com")) return true;

  const fromEnv = process.env.NEXT_PUBLIC_WEBSITE_URL?.trim() || process.env.SEGNA_WEBSITE_URL?.trim();
  if (fromEnv) {
    try {
      const allowed = new URL(fromEnv);
      if (allowed.origin === url.origin) return true;
    } catch {
      /* ignore */
    }
  }

  const extras = (process.env.SEGNA_WEBSITE_RETURN_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of extras) {
    try {
      if (new URL(origin).origin === url.origin) return true;
    } catch {
      /* ignore */
    }
  }

  return false;
}
