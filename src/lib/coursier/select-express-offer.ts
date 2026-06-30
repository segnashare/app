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

function isSlotService(offer: CoursierGetPriceOffer): boolean {
  return /cr[ée]neau/i.test(offer.Service);
}

/**
 * Choisit l’offre express immédiate la plus rapide (Prioritaire / Exclu…).
 * Les créneaux horaires sont conservés dans `offers` pour une sélection ultérieure (partie 2).
 */
export function selectCoursierExpressOffer(
  offers: CoursierGetPriceOffer[],
): CoursierGetPriceOffer | null {
  if (offers.length === 0) return null;

  const immediate = offers.filter((o) => !isSlotService(o));
  const pool = immediate.length > 0 ? immediate : offers;

  const sorted = [...pool].sort((a, b) => {
    const endDiff = parseCoursierDateMs(a.DeliveryEndDate) - parseCoursierDateMs(b.DeliveryEndDate);
    if (endDiff !== 0) return endDiff;
    return parsePriceEuros(a.Price) - parsePriceEuros(b.Price);
  });

  return sorted[0] ?? null;
}
