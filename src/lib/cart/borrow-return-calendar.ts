/** Fuseau pour l’échéance de retour : jour calendaire uniquement (dépassement après minuit Paris). */
export const BORROW_RETURN_TZ = "Europe/Paris";

const MS_PER_DAY = 86_400_000;

/** Clé `YYYY-MM-DD` du jour civil à Paris. */
export function borrowReturnParisDateKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BORROW_RETURN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Jours calendaires restants avant la date limite (0 = dernier jour, négatif = dépassé). */
export function borrowCalendarDaysUntilDue(nowMs: number, dueMs: number): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(dueMs)) return Number.NaN;
  const nowKey = borrowReturnParisDateKey(nowMs);
  const dueKey = borrowReturnParisDateKey(dueMs);
  const [ny, nm, nd] = nowKey.split("-").map(Number);
  const [dy, dm, dd] = dueKey.split("-").map(Number);
  const nowOrd = Date.UTC(ny, nm - 1, nd);
  const dueOrd = Date.UTC(dy, dm - 1, dd);
  return Math.round((dueOrd - nowOrd) / MS_PER_DAY);
}

/** True après le minuit Paris suivant le jour limite. */
export function isBorrowReturnOverdueParis(nowMs: number, dueMs: number): boolean {
  const days = borrowCalendarDaysUntilDue(nowMs, dueMs);
  return Number.isFinite(days) && days < 0;
}

/** Phase alerte (œil + « Retourne ta box ») : J-3 inclus jusqu’à la fin du jour limite, puis retard. */
export function isBorrowReturnAlertPhaseParis(nowMs: number, dueMs: number): boolean {
  const days = borrowCalendarDaysUntilDue(nowMs, dueMs);
  return Number.isFinite(days) && days <= 3;
}

/** Dernier jour calendaire avant dépassement (minuit Paris suivant). */
export function isBorrowReturnDueJjDayParis(nowMs: number, dueMs: number): boolean {
  const days = borrowCalendarDaysUntilDue(nowMs, dueMs);
  return Number.isFinite(days) && days === 0;
}
