import { borrowOverdueRateBps } from "@/lib/emprunt/borrow-overdue-penalty";

export const BORROW_OVERDUE_CG_LOCATION_HREF = "https://www.segnashare.com/conditions-location";

function sanitizeLateDayIndex(lateDayIndex: number): number {
  return Math.max(1, Math.trunc(lateDayIndex));
}

export function borrowOverdueRatePercent(lateDayIndex: number): number {
  return Math.round(borrowOverdueRateBps(sanitizeLateDayIndex(lateDayIndex)) / 100);
}

/** Compteur : « 1 jour », « 5 jours ». */
export function formatBorrowOverdueDayCountFr(lateDayIndex: number): string {
  const d = sanitizeLateDayIndex(lateDayIndex);
  return d === 1 ? "1 jour" : `${d} jours`;
}

/** Carte liste / méta : « 1 jour de retard », « 5 jours de retard ». */
export function formatBorrowOverdueDaysLabelFr(lateDayIndex: number): string {
  const d = sanitizeLateDayIndex(lateDayIndex);
  return d === 1 ? "1 jour de retard" : `${d} jours de retard`;
}

/** Titre bloc emprunt / bandeau (une ligne = un bloc visuel). */
export function formatBorrowOverdueHeadlineLinesFr(
  lateDayIndex: number,
  opts?: { escalated?: boolean },
): string[] {
  const d = sanitizeLateDayIndex(lateDayIndex);
  const lines = ["Retour en retard", d === 1 ? "1er jour" : `${d} jours`];
  if (opts?.escalated) lines.push("Dossier transmis");
  return lines;
}

/** Lignes commande + retard (bandeau Échange). */
export function formatBorrowOverdueOrderLinesFr(orderNumberCompact: string, lateDayIndex: number): string[] {
  return [`Commande ${orderNumberCompact}`, formatBorrowOverdueDaysLabelFr(lateDayIndex)];
}

/** Taux du jour (1 ou 2 lignes). */
export function formatBorrowOverdueDailyRateLinesFr(lateDayIndex: number): string[] {
  const d = sanitizeLateDayIndex(lateDayIndex);
  const pct = borrowOverdueRatePercent(d);
  if (d <= 7) {
    if (d >= 6) {
      return [
        `${pct} % de la valeur de ton panier par jour.`,
        "Dès le 8ᵉ jour, le taux passe à 5 %.",
      ];
    }
    return [`${pct} % de la valeur de ton panier par jour.`];
  }
  return [`${pct} % de la valeur de ton panier par jour (à partir du 8ᵉ jour de retard).`];
}

/** Rappel des deux tranches (feuille « En savoir plus », J-J). */
export function formatBorrowOverdueRateTiersSummaryLinesFr(): string[] {
  return [
    "3 % de la valeur du panier par jour les 7 premiers jours de retard.",
    "5 % par jour à partir du 8ᵉ jour.",
  ];
}

/** Intro pénalités (1ʳᵉ ligne + taux). */
export function formatBorrowOverduePenaltyIntroLinesFr(lateDayIndex: number): string[] {
  return ["Des pénalités journalières s'appliquent.", ...formatBorrowOverdueDailyRateLinesFr(lateDayIndex)];
}

/** Corps bandeau Échange. */
export function formatBorrowOverdueBannerBodyLinesFr(lateDayIndex: number): string[] {
  return [
    ...formatBorrowOverduePenaltyIntroLinesFr(lateDayIndex),
    "Chaque jour de retard est prélevé sur ta carte enregistrée.",
    "Dépose ton colis au relais pour stopper l'accumulation.",
    "Tu peux aussi prolonger l'échange si tu en as encore la possibilité.",
  ];
}

/** Corps bloc emprunt (hors lien CG et montant €). */
export function formatBorrowOverdueEmpruntBodyLinesFr(lateDayIndex: number): string[] {
  return [
    ...formatBorrowOverduePenaltyIntroLinesFr(lateDayIndex),
    "Chaque jour de retard est prélevé automatiquement sur ta carte enregistrée (minimum Stripe 0,50 € par prélèvement).",
    "Tant que ton colis n'est pas déposé au relais, les pénalités continuent de s'accumuler.",
  ];
}

/** Alerte prélèvement carte refusé. */
export function formatBorrowOverdueFailedChargeLinesFr(): string[] {
  return [
    "Un prélèvement sur ta carte n'a pas abouti.",
    "Mets à jour ton moyen de paiement pour régulariser la situation.",
  ];
}

/** J+14 : escalade possible. */
export function formatBorrowOverdueEscalationHintLinesFr(lateDayIndex: number): string[] | null {
  if (sanitizeLateDayIndex(lateDayIndex) < 14) return null;
  return [
    "Au-delà de 14 jours sans retour déposé au relais, ton dossier peut être transmis à notre équipe.",
    "Contacte le support si tu as besoin d'aide.",
  ];
}

/** Email : tranche 3 % vs 5 %. */
export function formatBorrowOverdueEmailTierNoteLinesFr(lateDayIndex: number): string[] {
  const d = sanitizeLateDayIndex(lateDayIndex);
  if (d <= 7) {
    return ["Cette première semaine de retard, la pénalité est de 3 % de la valeur de ton panier par jour."];
  }
  return ["À partir du 8ᵉ jour de retard, la pénalité est de 5 % de la valeur de ton panier par jour."];
}

/** Objet e-mail retard quotidien. */
export function formatBorrowOverdueEmailSubjectFr(lateDayIndex: number): string {
  const d = sanitizeLateDayIndex(lateDayIndex);
  return d === 1 ? "Retour en retard, 1er jour de pénalité" : `Retour en retard, ${d} jours`;
}

/** Corps e-mail retard (texte brut, lignes séparées par \\n). */
export function formatBorrowOverdueEmailBodyLinesFr(opts: {
  lateDayIndex: number;
  cartLabel: string;
  ratePercent: number;
  chargeNoteLines: string[];
  tierLines: string[];
}): string[] {
  const day = sanitizeLateDayIndex(opts.lateDayIndex);
  const dayLabel = day === 1 ? "1er jour de retard" : `${day}e jour de retard`;
  return [
    `${dayLabel} pour ${opts.cartLabel}.`,
    `Taux du jour : ${opts.ratePercent} %.`,
    ...opts.chargeNoteLines,
    ...opts.tierLines,
    "Dépose ton colis au relais pour stopper l'accumulation.",
    "Tu peux aussi prolonger l'échange depuis l'app.",
  ];
}
