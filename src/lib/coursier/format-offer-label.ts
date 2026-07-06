import { SEGNA_TIMEZONE } from "@/lib/datetime/segna-datetime";
import { htToVatAndTtcCents } from "@/lib/cart/cart-checkout-vat";
import { buildCoursierMemberArrivalLineFr } from "@/lib/coursier/format-quote-for-display";
import { shouldShowCoursierServiceInOptionLabel } from "@/lib/coursier/express-service";
import { coursierOfferPriceHtCents } from "@/lib/coursier/selectable-offers";
import type { CoursierGetPriceOffer } from "@/lib/coursier/types";

function parseCoursierDate(value: string): Date | null {
  const normalized = value.trim().replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDayPrefix(d: Date, now: Date): string {
  const sameDay =
    d.toLocaleDateString("fr-FR", { timeZone: SEGNA_TIMEZONE }) ===
    now.toLocaleDateString("fr-FR", { timeZone: SEGNA_TIMEZONE });
  if (sameDay) return "Aujourd'hui";

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.toLocaleDateString("fr-FR", { timeZone: SEGNA_TIMEZONE }) ===
    tomorrow.toLocaleDateString("fr-FR", { timeZone: SEGNA_TIMEZONE });
  if (isTomorrow) return "Demain";

  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: SEGNA_TIMEZONE,
  }).format(d);
}

function formatOfferPriceTtcEuros(offer: CoursierGetPriceOffer): string {
  const htCents = coursierOfferPriceHtCents(offer);
  const { ttcCents } = htToVatAndTtcCents(htCents);
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(ttcCents / 100);
}

/** Libellé bouton après confirmation (jour + plage horaire). */
export function formatCoursierOfferSlotButtonLabel(offer: CoursierGetPriceOffer, now = new Date()): string {
  const deliveryStart = parseCoursierDate(offer.DeliveryStartDate);
  const day = deliveryStart ? formatDayPrefix(deliveryStart, now) : "";
  const window = buildCoursierMemberArrivalLineFr({
    deliveryStartDate: offer.DeliveryStartDate,
    deliveryEndDate: offer.DeliveryEndDate,
  });
  return [day, window].filter(Boolean).join(" · ");
}

/** Sous-titre prestation Coursier (ServiceId + libellé API). */
export function formatCoursierOfferServiceCaption(offer: CoursierGetPriceOffer): string {
  return `Service ${String(offer.ServiceId).trim()} · ${offer.Service.trim()}`;
}

export function coursierOffersHaveMultipleServices(offers: CoursierGetPriceOffer[]): boolean {
  const ids = new Set(offers.map((o) => String(o.ServiceId).trim()).filter(Boolean));
  return ids.size > 1;
}

/** Libellé option créneau pour le sélecteur checkout. */
export function formatCoursierOfferOptionLabel(offer: CoursierGetPriceOffer, now = new Date()): string {
  const deliveryStart = parseCoursierDate(offer.DeliveryStartDate);
  const day = deliveryStart ? formatDayPrefix(deliveryStart, now) : "";
  const window = buildCoursierMemberArrivalLineFr({
    deliveryStartDate: offer.DeliveryStartDate,
    deliveryEndDate: offer.DeliveryEndDate,
  });
  const price = formatOfferPriceTtcEuros(offer);
  const showService = shouldShowCoursierServiceInOptionLabel(offer);
  const parts = [day, window, showService ? offer.Service.trim() : null, price].filter(Boolean);
  return parts.join(" · ");
}
