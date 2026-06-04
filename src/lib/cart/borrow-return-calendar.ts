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

/** Ajoute N jours calendaires à une clé date Paris (`YYYY-MM-DD`). */
export function addParisCalendarDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const ord = Date.UTC(y, m - 1, d) + days * MS_PER_DAY;
  return borrowReturnParisDateKey(ord);
}

/** Ajoute N mois calendaires (approx. via Date UTC — aligné SQL `+ interval '1 month'`). */
export function addParisCalendarMonths(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const ord = Date.UTC(y, m - 1 + months, d);
  return borrowReturnParisDateKey(ord);
}

/** Début du jour calendaire Paris (00:00) en ms UTC. */
export function parisMidnightUtcMs(parisDateKey: string): number {
  const target = parisDateKey.trim();
  const [y, m, d] = target.split("-").map(Number);
  let lo = Date.UTC(y, m - 1, d - 1, 0, 0, 0);
  let hi = Date.UTC(y, m - 1, d + 2, 0, 0, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (borrowReturnParisDateKey(mid) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 23:59:59 Europe/Paris pour une date calendaire Paris. */
export function borrowReturnDueEndOfParisDayMs(parisDateKey: string): number {
  const nextDay = addParisCalendarDays(parisDateKey, 1);
  return parisMidnightUtcMs(nextDay) - 1000;
}

/** Échéance = jour réception Paris + N jours, fin à 23:59:59 Paris. */
export function computeBorrowReturnDueMsFromReceiptDays(
  receiptConfirmedAtIso: string,
  durationDays: number,
): number {
  const receiptMs = Date.parse(receiptConfirmedAtIso);
  if (!Number.isFinite(receiptMs) || durationDays < 1) return Number.NaN;
  const receiptParis = borrowReturnParisDateKey(receiptMs);
  const dueParis = addParisCalendarDays(receiptParis, durationDays);
  return borrowReturnDueEndOfParisDayMs(dueParis);
}

/** Échéance = jour réception Paris + 1 mois calendaire, fin à 23:59:59 Paris. */
export function computeBorrowReturnDueMsFromReceiptMonth(receiptConfirmedAtIso: string): number {
  const receiptMs = Date.parse(receiptConfirmedAtIso);
  if (!Number.isFinite(receiptMs)) return Number.NaN;
  const receiptParis = borrowReturnParisDateKey(receiptMs);
  const dueParis = addParisCalendarMonths(receiptParis, 1);
  return borrowReturnDueEndOfParisDayMs(dueParis);
}

/** Prolongation : +N jours calendaires Paris, normalisé 23:59:59. */
export function addBorrowCalendarDaysParis(dueMs: number, extraDays: number): number {
  if (!Number.isFinite(dueMs)) return dueMs;
  const extra = Math.max(0, Math.trunc(extraDays));
  if (extra <= 0) return dueMs;
  const dueParis = borrowReturnParisDateKey(dueMs);
  return borrowReturnDueEndOfParisDayMs(addParisCalendarDays(dueParis, extra));
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
