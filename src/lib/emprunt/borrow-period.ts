const MS_PER_DAY = 86_400_000;

export { MS_PER_DAY as BORROW_MS_PER_DAY };

/** Jours restants affichés au plafond (cohérent « Il te reste N jours »). */
export function borrowRemainingDaysDisplayed(remainingMs: number): number {
  return Math.ceil(remainingMs / MS_PER_DAY);
}

/**
 * Liste Échange : emprunt livré avec au plus 3 jours restants (même règle que le décompte emprunt).
 * Inclut l’échéance dépassée.
 */
export function isBorrowReturnUrgentForExchangeList(nowMs: number, deadlineMs: number): boolean {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return false;
  const msLeft = deadlineMs - nowMs;
  if (msLeft <= 0) return true;
  return borrowRemainingDaysDisplayed(msLeft) <= 3;
}

/** Dernières heures avant échéance : compteur h / min / s (header + bloc central emprunt). */
export function formatBorrowLastHoursCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h >= 1) {
    return `${h}\u00a0h ${m}\u00a0min ${s}\u00a0s`;
  }
  if (m >= 1) {
    return `${m}\u00a0min ${s}\u00a0s`;
  }
  return `${s}\u00a0s`;
}

/** Durée d’emprunt catalogue pour les membres non abonnés (à partir de la livraison). */
export const BORROW_PERIOD_DAYS_GUEST = 10;

/** Durée d’emprunt pour Segna X (à partir de la livraison). */
export const BORROW_PERIOD_DAYS_SEGNA_X = 30;

export type SegnaBorrowMembershipLabel = "Guest" | "Membre +" | "Membre X";

/**
 * Instant de réception aller pour le calcul des délais d’emprunt / retour.
 * Préfère `shipments.delivered_at` (figé à la livraison) ; retombe sur `updated_at` si absent (données legacy).
 */
export function resolveOutboundBorrowDeliveredAtIso(
  deliveredAtIso: string | null | undefined,
  shipmentUpdatedAtIso: string | null | undefined,
): string | null {
  const d = typeof deliveredAtIso === "string" ? deliveredAtIso.trim() : "";
  if (d) return d;
  const u = typeof shipmentUpdatedAtIso === "string" ? shipmentUpdatedAtIso.trim() : "";
  return u || null;
}

/**
 * Date limite de retour : 10 j. (Guest), 30 j. (Membre X), +1 mois calendaire depuis la livraison (Membre +).
 */
/** Libellé produit pour e-mails / notifications (durée de location). */
export function describeBorrowPeriodForMembership(membershipLabel: SegnaBorrowMembershipLabel): string {
  if (membershipLabel === "Guest") {
    return "10 jours à compter de la réception de ta commande";
  }
  if (membershipLabel === "Membre X") {
    return "30 jours à compter de la réception de ta commande";
  }
  return "1 mois calendaire à compter de la réception de ta commande";
}

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
  if (membershipLabel === "Membre X") {
    return deliveredAtMs + BORROW_PERIOD_DAYS_SEGNA_X * MS_PER_DAY;
  }
  const d = new Date(deliveredAtMs);
  d.setMonth(d.getMonth() + 1);
  return d.getTime();
}
