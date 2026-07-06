import type { CoursierGetPriceOffer } from "@/lib/coursier/types";

/** Service express Segna par défaut (créneau 2 h direct) — libellés UI. */
export const COURSIER_EXPRESS_SERVICE_ID = "10";

/**
 * IDs Coursier autorisés au checkout (`COURSIER_CHECKOUT_SERVICE_IDS`, séparateur `,`).
 * Vide / absent → toutes les offres `getprice` (utile en dev).
 * Ex. prod : `10` — ex. dev : `10,1,2`.
 */
export function readCoursierCheckoutServiceIds(): string[] | null {
  const raw = (process.env.COURSIER_CHECKOUT_SERVICE_IDS ?? "").trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

export function isCoursierCheckoutOffer(offer: CoursierGetPriceOffer): boolean {
  const allowlist = readCoursierCheckoutServiceIds();
  if (allowlist === null) return true;
  return allowlist.includes(String(offer.ServiceId).trim());
}

/** @deprecated alias — préférer `isCoursierCheckoutOffer`. */
export function isCoursierDirect2hSlotOffer(offer: CoursierGetPriceOffer): boolean {
  return isCoursierCheckoutOffer(offer);
}

/** Offres checkout express après filtre `COURSIER_CHECKOUT_SERVICE_IDS`. */
export function filterCoursierDirect2hSlotOffers(
  offers: CoursierGetPriceOffer[],
): CoursierGetPriceOffer[] {
  return offers.filter(isCoursierCheckoutOffer);
}

/** Afficher le nom de prestation dans le sélecteur (quand plusieurs types possibles). */
export function shouldShowCoursierServiceInOptionLabel(offer: CoursierGetPriceOffer): boolean {
  const allowlist = readCoursierCheckoutServiceIds();
  if (allowlist === null) return true;
  if (allowlist.length === 1 && allowlist[0] === String(offer.ServiceId).trim()) return false;
  return true;
}
