import { filterCoursierDirect2hSlotOffers } from "@/lib/coursier/express-service";
import type { CoursierGetPriceOffer } from "@/lib/coursier/types";

function parseCoursierDateMs(value: string): number {
  const normalized = value.trim().replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function parsePriceEuros(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : Number.POSITIVE_INFINITY;
}

/** Premier créneau « 2 h direct » disponible (le plus tôt, puis le moins cher). */
export function selectCoursierExpressOffer(
  offers: CoursierGetPriceOffer[],
): CoursierGetPriceOffer | null {
  const slots = filterCoursierDirect2hSlotOffers(offers);
  if (slots.length === 0) return null;

  const sorted = [...slots].sort((a, b) => {
    const startDiff =
      parseCoursierDateMs(a.DeliveryStartDate) - parseCoursierDateMs(b.DeliveryStartDate);
    if (startDiff !== 0) return startDiff;
    return parsePriceEuros(a.Price) - parsePriceEuros(b.Price);
  });

  return sorted[0] ?? null;
}
