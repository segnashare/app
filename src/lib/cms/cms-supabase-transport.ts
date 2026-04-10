/**
 * Erreurs réseau / fetch côté serveur Node (Supabase injoignable, DNS, coupure, etc.).
 * À traiter comme repli gracieux (CMS vide), pas comme erreur métier RPC.
 */
export function isSupabaseTransportFailure(message: string, cause?: unknown): boolean {
  const m = (message ?? "").toLowerCase();
  if (m.includes("fetch failed") || m.includes("failed to fetch")) return true;
  if (/econnrefused|enotfound|etimedout|network|socket|cert_|ssl/i.test(m)) return true;
  if (cause instanceof Error && /fetch|network|econnrefused/i.test(cause.message)) return true;
  return false;
}

export function warnCmsSupabaseUnreachable(label: string, detail?: string) {
  if (process.env.NODE_ENV !== "development") return;
  console.warn(
    `[CMS] ${label}${detail ? `: ${detail}` : ""} — impossible de joindre Supabase. ` +
      "Vérifie NEXT_PUBLIC_SUPABASE_URL, la clé anon, que le projet est en ligne et ta connexion. " +
      "Les blocs CMS seront vides jusqu’à ce que l’API réponde.",
  );
}
