/** Formate les horaires d’un point relais Sendcloud (style widget SPP). */

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type DayKey = (typeof DAY_KEYS)[number];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseSlot(raw: unknown): { start: string; end: string } | null {
  if (typeof raw === "string") {
    const m = raw.trim().match(/^(\d{1,2}:\d{2})\s*[/\-–—]\s*(\d{1,2}:\d{2})$/);
    if (!m) return null;
    return { start: m[1]!, end: m[2]! };
  }
  const o = asRecord(raw);
  if (!o) return null;
  const start = String(o.start_time ?? o.start ?? o.open ?? "").trim();
  const end = String(o.end_time ?? o.end ?? o.close ?? "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) return null;
  return { start, end };
}

function slotsForDay(hours: Record<string, unknown>, day: DayKey): { start: string; end: string }[] {
  const raw = hours[day] ?? hours[day.slice(0, 3)];
  if (raw == null) return [];
  if (typeof raw === "string") {
    const slot = parseSlot(raw);
    return slot ? [slot] : [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(parseSlot).filter((s): s is { start: string; end: string } => s != null);
}

function formatSlots(slots: { start: string; end: string }[]): string {
  return slots.map((s) => `${s.start} - ${s.end}`).join(", ");
}

/**
 * Libellé type Sendcloud : « Ouvert aujourd'hui: … » / « Ouvert demain: … ».
 * Retourne null si les horaires sont absents ou inexploitables.
 */
export function formatSendcloudServicePointHoursLabel(
  openingHours: unknown,
  now: Date = new Date(),
): string | null {
  const hours = asRecord(openingHours);
  if (!hours) return null;

  const todayIdx = now.getDay();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = DAY_KEYS[(todayIdx + offset) % 7]!;
    const slots = slotsForDay(hours, day);
    if (slots.length === 0) continue;
    const range = formatSlots(slots);
    if (offset === 0) return `Ouvert aujourd'hui: ${range}`;
    if (offset === 1) return `Ouvert demain: ${range}`;
    return `Ouvert: ${range}`;
  }
  return null;
}

/** Distance affichée Sendcloud (« 95 m », « 1,2 km »). */
export function formatSendcloudServicePointDistance(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const label = km < 10 ? km.toFixed(1).replace(".", ",") : String(Math.round(km));
  return `${label} km`;
}
