import type { CoursierGetPriceOffer, CoursierNormalizedExpressQuote } from "@/lib/coursier/types";
import { filterCoursierDirect2hSlotOffers } from "@/lib/coursier/express-service";
import { selectCoursierExpressOffer } from "@/lib/coursier/select-express-offer";

function parseCoursierDateMs(value: string): number {
  const normalized = value.trim().replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** Clé stable pour un créneau / service Coursier (checkout + Stripe metadata). */
export function coursierOfferSlotKey(offer: CoursierGetPriceOffer): string {
  return `${offer.ServiceId}|${offer.PickupStartDate}|${offer.DeliveryStartDate}`;
}

export function coursierOfferPriceHtCents(offer: CoursierGetPriceOffer): number {
  const euros = Number(offer.Price);
  if (!Number.isFinite(euros) || euros < 0) return 0;
  return Math.round(euros * 100);
}

export function findCoursierOfferBySlotKey(
  offers: CoursierGetPriceOffer[],
  slotKey: string,
): CoursierGetPriceOffer | null {
  const key = slotKey.trim();
  if (!key) return null;
  return offers.find((o) => coursierOfferSlotKey(o) === key) ?? null;
}

/** Créneaux 2 h direct triés par livraison, dédoublonnés, limités pour l’UI checkout. */
export function listCoursierSelectableOffers(
  offers: CoursierGetPriceOffer[],
  limit = 24,
): CoursierGetPriceOffer[] {
  const sorted = [...filterCoursierDirect2hSlotOffers(offers)].sort(
    (a, b) => parseCoursierDateMs(a.DeliveryStartDate) - parseCoursierDateMs(b.DeliveryStartDate),
  );
  const seen = new Set<string>();
  const out: CoursierGetPriceOffer[] = [];
  for (const offer of sorted) {
    const key = coursierOfferSlotKey(offer);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(offer);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildNormalizedCoursierQuoteFromOffer(
  offer: CoursierGetPriceOffer,
  offers: CoursierGetPriceOffer[],
): CoursierNormalizedExpressQuote {
  return {
    provider: "coursier",
    serviceId: offer.ServiceId,
    service: offer.Service,
    priceHtCents: coursierOfferPriceHtCents(offer),
    pickupStartDate: offer.PickupStartDate,
    pickupEndDate: offer.PickupEndDate,
    deliveryStartDate: offer.DeliveryStartDate,
    deliveryEndDate: offer.DeliveryEndDate,
    offers,
  };
}

export function resolveCoursierOfferFromGetprice(
  offers: CoursierGetPriceOffer[],
  slotKey?: string | null,
): CoursierGetPriceOffer | null {
  const checkoutOffers = filterCoursierDirect2hSlotOffers(offers);
  if (slotKey?.trim()) {
    const picked = findCoursierOfferBySlotKey(checkoutOffers, slotKey);
    if (picked) return picked;
  }
  return selectCoursierExpressOffer(checkoutOffers);
}
