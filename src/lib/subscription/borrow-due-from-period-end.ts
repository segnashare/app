import { SEGNA_TIMEZONE } from "@/lib/datetime/segna-datetime";

/**
 * Instant 23:59:59 Europe/Paris pour la date calendaire Paris de `periodEndIso`.
 */
export function borrowDueAtFromPeriodEnd(periodEndIso: string): string {
  const d = new Date(periodEndIso);
  if (Number.isNaN(d.getTime())) return periodEndIso;

  const parisDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEGNA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

  // Midi UTC du jour civil Paris → lit le vrai offset (CET/CEST) pour ce jour.
  const noonUtc = new Date(`${parisDate}T12:00:00.000Z`);
  const offsetLabel =
    new Intl.DateTimeFormat("en-US", {
      timeZone: SEGNA_TIMEZONE,
      timeZoneName: "longOffset",
    })
      .formatToParts(noonUtc)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";

  // "GMT+02:00" | "GMT+2" | "GMT+01:00"
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/i.exec(offsetLabel);
  const sign = m?.[1] === "-" ? "-" : "+";
  const hh = String(Number(m?.[2] ?? 1)).padStart(2, "0");
  const mm = String(Number(m?.[3] ?? 0)).padStart(2, "0");
  const iso = `${parisDate}T23:59:59${sign}${hh}:${mm}`;
  const end = new Date(iso);
  return Number.isNaN(end.getTime()) ? periodEndIso : end.toISOString();
}
