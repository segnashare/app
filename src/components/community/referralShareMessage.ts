const INVITE_PATH = "/auth/sign-up/email";

/**
 * URL d’inscription avec parrainage (`?ref=`) pour que le filleul arrive avec le code
 * (à lire côté auth / bootstrap quand vous brancherez la consommation du code).
 */
export function buildReferralInviteUrl(origin: string, code: string | null): string {
  const base = origin.replace(/\/$/, "");
  const u = new URL(INVITE_PATH, `${base}/`);
  const trimmed = typeof code === "string" ? code.trim() : "";
  if (trimmed.length > 0) {
    u.searchParams.set("ref", trimmed);
  }
  return u.toString();
}

/** Corps du message (sans l’URL ni le titre) — éviter de répéter la ligne d’accroche déjà passée en `title` au partage. */
export function buildReferralInviteShareBody(_code: string | null): string {
  return `Échange de vêtements entre filles, dressing partagé.

Avec mon lien : 100 crédits chacune + ton premier échange offert.`;
}

/** Données pour `navigator.share` : texte marketing + lien (comme un partage « app + offre », cf. aperçu iOS). */
export function buildReferralNativeSharePayload(code: string | null, origin: string): {
  title: string;
  text: string;
  url: string;
} {
  const url = buildReferralInviteUrl(origin, code);
  return {
    title: "Rejoins-moi sur Segna ✨",
    text: buildReferralInviteShareBody(code),
    url,
  };
}
