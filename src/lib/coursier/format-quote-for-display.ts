import { SEGNA_TIMEZONE } from "@/lib/datetime/segna-datetime";

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Prix HT express Coursier en centimes (aligné facturation Stripe). */
export function coursierQuoteFeeCentsFromRaw(quote: Record<string, unknown>): number | null {
  const fromPriceHtCents = asFiniteNumber(quote.priceHtCents);
  if (fromPriceHtCents != null && fromPriceHtCents >= 0) return Math.round(fromPriceHtCents);

  const fee = asFiniteNumber(quote.fee);
  if (fee != null && fee >= 0) return Math.round(fee);
  return null;
}

function parseCoursierDate(value: string): Date | null {
  const normalized = value.trim().replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatClockFr(d: Date): string {
  return d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SEGNA_TIMEZONE,
  });
}

function formatMaybeDateFr(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = parseCoursierDate(value);
  if (!d) return value.trim();
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: SEGNA_TIMEZONE,
  }).format(d);
}

/**
 * Plage horaire de livraison estimée à partir des créneaux Coursier
 * (`DeliveryStartDate` / `DeliveryEndDate`).
 */
export function buildCoursierMemberArrivalLineFr(
  quote: Record<string, unknown> | null | undefined,
): string | null {
  if (!quote) return null;

  const startRaw =
    typeof quote.deliveryStartDate === "string"
      ? quote.deliveryStartDate
      : typeof quote.DeliveryStartDate === "string"
        ? quote.DeliveryStartDate
        : null;
  const endRaw =
    typeof quote.deliveryEndDate === "string"
      ? quote.deliveryEndDate
      : typeof quote.DeliveryEndDate === "string"
        ? quote.DeliveryEndDate
        : null;

  if (!startRaw || !endRaw) return null;

  const start = parseCoursierDate(startRaw);
  const end = parseCoursierDate(endRaw);
  if (!start || !end) {
    const formattedStart = formatMaybeDateFr(startRaw);
    const formattedEnd = formatMaybeDateFr(endRaw);
    if (formattedStart && formattedEnd) return `${formattedStart} - ${formattedEnd}`;
    return formattedStart ?? formattedEnd;
  }

  return `${formatClockFr(start)} - ${formatClockFr(end)}`;
}
