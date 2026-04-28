const MS_PER_DAY = 86_400_000;

/** Durée d’emprunt catalogue pour les membres non abonnés (à partir de la livraison). */
export const BORROW_PERIOD_DAYS_GUEST = 10;

export type SegnaBorrowMembershipLabel = "Guest" | "Membre +" | "Membre X";

/** Date limite de retour : 10 j. (Guest) ou +1 mois calendaire depuis la livraison (abonnés). */
export function computeBorrowDeadlineMs(
  deliveredAtMs: number,
  membershipLabel: SegnaBorrowMembershipLabel,
): number {
  if (!Number.isFinite(deliveredAtMs) || deliveredAtMs <= 0) {
    return Number.NaN;
  }
  if (membershipLabel === "Guest") {
    return deliveredAtMs + BORROW_PERIOD_DAYS_GUEST * MS_PER_DAY;
  }
  const d = new Date(deliveredAtMs);
  d.setMonth(d.getMonth() + 1);
  return d.getTime();
}
