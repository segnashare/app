/** Fuseau horaire Segna : affichage UI, logique calendaire métier, crons. */
export const SEGNA_TIMEZONE = "Europe/Paris";

export function parseSegnaInstant(input: string | number | Date | null | undefined): Date | null {
  if (input == null || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

type FormatDateTimeOpts = {
  dateStyle?: "full" | "long" | "medium" | "short";
  timeStyle?: "full" | "long" | "medium" | "short";
};

/** Date + heure en heure de Paris (ex. `created_at`, `updated_at`). */
export function formatDateTimeParis(
  input: string | number | Date | null | undefined,
  opts: FormatDateTimeOpts = { dateStyle: "short", timeStyle: "short" },
): string {
  const d = parseSegnaInstant(input);
  if (!d) return "—";
  return d.toLocaleString("fr-FR", { ...opts, timeZone: SEGNA_TIMEZONE });
}

/** Date seule en heure de Paris. */
export function formatDateParis(
  input: string | number | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" },
): string {
  const d = parseSegnaInstant(input);
  if (!d) return "—";
  return d.toLocaleDateString("fr-FR", { ...opts, timeZone: SEGNA_TIMEZONE });
}

/** Date longue en heure de Paris (ex. livraison prévue). */
export function formatLongDateParis(input: string | number | Date | null | undefined): string {
  return formatDateParis(input, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export type ParisClockParts = {
  hour: number;
  minute: number;
  /** ISO weekday : 1 = lundi … 7 = dimanche. */
  weekday: number;
};

export function getParisClockParts(nowMs: number = Date.now()): ParisClockParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SEGNA_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date(nowMs));

  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const weekdayLabel = parts.find((p) => p.type === "weekday")?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    hour,
    minute,
    weekday: weekdayMap[weekdayLabel] ?? 0,
  };
}

export type ParisCronSlot = {
  hour: number;
  minute?: number;
  /** ISO weekday : 1 = lundi … 7 = dimanche. */
  weekday?: number;
};

/** Vrai si l’instant courant correspond au créneau Paris (été/hiver). */
export function isParisCronSlot(slot: ParisCronSlot, nowMs: number = Date.now()): boolean {
  const { hour, minute, weekday } = getParisClockParts(nowMs);
  if (hour !== slot.hour) return false;
  if ((slot.minute ?? 0) !== minute) return false;
  if (slot.weekday != null && weekday !== slot.weekday) return false;
  return true;
}
