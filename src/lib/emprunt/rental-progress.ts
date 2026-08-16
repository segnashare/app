/** Progression location (jours calendaires Paris) entre livraison aller et échéance retour. */

function parisDateKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function parisCalendarDaysBetween(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  const a = parisDateKey(startMs);
  const b = parisDateKey(endMs);
  const diff = Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000,
  );
  return Math.max(0, diff);
}

/** Jours calendaires restants (0 = jour J, négatif = dépassé). */
function parisCalendarDaysUntilDue(nowMs: number, dueMs: number): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(dueMs)) return Number.NaN;
  const nowKey = parisDateKey(nowMs);
  const dueKey = parisDateKey(dueMs);
  const [ny, nm, nd] = nowKey.split("-").map(Number);
  const [dy, dm, dd] = dueKey.split("-").map(Number);
  return Math.round(
    (Date.UTC(dy, dm - 1, dd) - Date.UTC(ny, nm - 1, nd)) / 86_400_000,
  );
}

export type RentalProgressTone = "blue" | "orange" | "red";

export type RentalProgressSnapshot = {
  totalDays: number;
  elapsedDays: number;
  baseDays: number;
  extensionDays: number;
  /** true si on est après le jour d’échéance (numérateur > dénominateur). */
  overdue: boolean;
  /**
   * Position 0–1 de l’échéance initiale (hors prolongation).
   * Présent dès qu’il y a une prolongation, ou en retard.
   */
  initialDueMarkerRatio: number | null;
  /**
   * En retard uniquement : position 0–1 de l’échéance avec prolongations
   * sur la piste recalée jusqu’à aujourd’hui.
   */
  extendedDueMarkerRatio: number | null;
  /** 0–1 */
  ratio: number;
  label: string;
  /** blue défaut ; orange J-2/J-1 ; red jour J (barre pleine) ou retard. */
  tone: RentalProgressTone;
};

export function rentalProgressToneFromDaysUntilDue(daysUntil: number): RentalProgressTone {
  if (!Number.isFinite(daysUntil) || daysUntil <= 0) return "red";
  if (daysUntil <= 2) return "orange";
  return "blue";
}

/**
 * Barre unique : jours écoulés depuis la livraison / durée checkout jusqu’à l’échéance.
 * L’échéance métier est `réception + N j` (ex. 7 j → due le 22 si reçu le 15) :
 * le dénominateur est donc N (= écart calendaire), pas N+1 inclusif.
 * Jour de réception → `1 / N j` ; jour J → `N / N j` (barre pleine) ; en retard le
 * numérateur continue (ex. `8 / 7 j`) avec marqueurs d’échéances.
 */
export function computeRentalProgress(input: {
  startMs: number;
  dueMs: number;
  nowMs?: number;
  /** Jours de prolongation payés (inclus dans `dueMs`). */
  extensionDays?: number;
}): RentalProgressSnapshot | null {
  const startMs = input.startMs;
  const dueMs = input.dueMs;
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(dueMs)) return null;
  if (parisDateKey(dueMs) < parisDateKey(startMs)) return null;

  // Aligné sur checkout : due = start + N → total = N (pas le span inclusif N+1).
  const totalDays = Math.max(1, parisCalendarDaysBetween(startMs, dueMs));
  const rawExt = Number.isFinite(input.extensionDays)
    ? Math.max(0, Math.trunc(input.extensionDays!))
    : 0;
  const extensionDays = Math.min(rawExt, Math.max(0, totalDays - 1));
  const baseDays = Math.max(1, totalDays - extensionDays);

  const daysUntil = parisCalendarDaysUntilDue(nowMs, dueMs);
  const overdue = Number.isFinite(daysUntil) && daysUntil < 0;
  const rawElapsed = Math.max(0, parisCalendarDaysBetween(startMs, nowMs) + 1);
  // Avant / jour J : plafonner à N pour ne pas passer en « retard » le jour d’échéance.
  const elapsedDays = overdue ? totalDays - daysUntil : Math.min(totalDays, rawElapsed);
  const ratio = Math.min(1, Math.max(0, elapsedDays / totalDays));
  const tone = rentalProgressToneFromDaysUntilDue(daysUntil);

  // Marqueur échéance initiale dès qu’il y a prolongation ; en retard, échelle → aujourd’hui.
  let initialDueMarkerRatio: number | null = null;
  let extendedDueMarkerRatio: number | null = null;
  if (overdue) {
    initialDueMarkerRatio = Math.min(1, baseDays / elapsedDays);
    extendedDueMarkerRatio = Math.min(1, totalDays / elapsedDays);
  } else if (extensionDays > 0) {
    initialDueMarkerRatio = Math.min(1, baseDays / totalDays);
  }

  return {
    totalDays,
    elapsedDays,
    baseDays,
    extensionDays,
    overdue,
    initialDueMarkerRatio,
    extendedDueMarkerRatio,
    ratio,
    label: `${elapsedDays} / ${totalDays} j`,
    tone,
  };
}
