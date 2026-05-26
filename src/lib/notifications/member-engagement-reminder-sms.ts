/** SMS rappels engagement membre (cron, gate `SEGNA_NOTIFY_SMS_ALERTS=1`). */

const SMS_MAX_LEN = 320;
const LIKED_PIECE_LABEL_MAX = 42;

/** 1er rappel — compte entre J+3 et J+9, onboarding in-app ≠ `finished`. */
export function buildOnboardingIncompleteReminderSms(): string {
  return "Ton onboarding n’est pas terminé. Finalise-le pour emprunter ton premier panier gratuitement !";
}

/** 2e rappel — compte ≥ J+10, même critère onboarding. */
export function buildOnboardingIncompleteFollowupReminderSms(): string {
  return "Il te reste quelques étapes pour finir ton onboarding et emprunter ton 1er panier. On t’attend sur l’app !";
}

export function formatFrenchAndList(parts: string[]): string {
  const trimmed = parts.map((p) => p.trim()).filter(Boolean);
  if (trimmed.length === 0) return "";
  if (trimmed.length === 1) return trimmed[0];
  if (trimmed.length === 2) return `${trimmed[0]} et ${trimmed[1]}`;
  return `${trimmed.slice(0, -1).join(", ")} et ${trimmed[trimmed.length - 1]}`;
}

/** Libellé court « titre (marque) » pour SMS. */
export function buildPieceSmsLabel(
  title: string | null | undefined,
  brand: string | null | undefined,
): string {
  const t = (title ?? "").trim() || "Pièce";
  const b = (brand ?? "").trim();
  const raw = b ? `${t} (${b})` : t;
  if (raw.length <= LIKED_PIECE_LABEL_MAX) return raw;
  return `${raw.slice(0, LIKED_PIECE_LABEL_MAX - 1).trim()}…`;
}

/**
 * Rappel pièces likées : jusqu’à 3 libellés « titre (marque) ».
 * `null` si aucun libellé exploitable.
 */
export function buildLikedItemsAvailableReminderSms(pieceLabels: string[]): string | null {
  const labels = pieceLabels.map((l) => l.trim()).filter(Boolean).slice(0, 3);
  if (labels.length === 0) return null;

  const list = formatFrenchAndList(labels);
  const verb = labels.length === 1 ? "est disponible" : "sont disponibles";
  const body = `${list} ${verb} à l'emprunt. Découvre notre offre de lancement et profite de l'échange gratuit !`;
  if (body.length <= SMS_MAX_LEN) return body;

  const shorter = labels.map((l) =>
    l.length > 28 ? `${l.slice(0, 27).trim()}…` : l,
  );
  const retry = `${formatFrenchAndList(shorter)} ${shorter.length === 1 ? "est disponible" : "sont disponibles"} à l'emprunt. Découvre notre offre de lancement et profite de l'échange gratuit !`;
  return retry.length <= SMS_MAX_LEN ? retry : retry.slice(0, SMS_MAX_LEN);
}

export function buildAbandonedCartReminderSms(): string {
  return "Ton panier t'attend. Finalise-le et profite de l'échange gratuit.";
}

/** Exemples statiques (validation produit / copy). */
export const MEMBER_ENGAGEMENT_REMINDER_SMS_COPY = {
  onboardingIncompleteFirst: buildOnboardingIncompleteReminderSms(),
  onboardingIncompleteSecond: buildOnboardingIncompleteFollowupReminderSms(),
  likedItemsAvailable: buildLikedItemsAvailableReminderSms([
    "Veste laine marine (Sandro)",
    "Pantalon beige (Mango)",
    "Robe satin (Ba&sh)",
  ]),
  abandonedCart: buildAbandonedCartReminderSms(),
} as const;
