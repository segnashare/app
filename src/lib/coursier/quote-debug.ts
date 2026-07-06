import {
  isCoursierCheckoutOffer,
  readCoursierCheckoutServiceIds,
} from "@/lib/coursier/express-service";
import type { CoursierGetPriceOffer } from "@/lib/coursier/types";

export type CoursierQuoteDebugOffer = {
  serviceId: string;
  service: string;
  pickupStart: string;
  pickupEnd: string;
  deliveryStart: string;
  deliveryEnd: string;
  priceHt: string;
  includedInCheckout: boolean;
};

export type CoursierQuoteDebugSummary = {
  checkoutServiceIdsFilter: string[] | null;
  rawOfferCount: number;
  checkoutOfferCount: number;
  excludedOfferCount: number;
  offers: CoursierQuoteDebugOffer[];
};

export function buildCoursierQuoteDebugSummary(allOffers: CoursierGetPriceOffer[]): CoursierQuoteDebugSummary {
  const filter = readCoursierCheckoutServiceIds();
  const offers = allOffers.map((offer) => ({
    serviceId: offer.ServiceId,
    service: offer.Service,
    pickupStart: offer.PickupStartDate,
    pickupEnd: offer.PickupEndDate,
    deliveryStart: offer.DeliveryStartDate,
    deliveryEnd: offer.DeliveryEndDate,
    priceHt: offer.Price,
    includedInCheckout: isCoursierCheckoutOffer(offer),
  }));
  const checkoutOfferCount = offers.filter((o) => o.includedInCheckout).length;
  return {
    checkoutServiceIdsFilter: filter,
    rawOfferCount: offers.length,
    checkoutOfferCount,
    excludedOfferCount: offers.length - checkoutOfferCount,
    offers,
  };
}

export function logCoursierQuoteDebug(label: string, summary: CoursierQuoteDebugSummary): void {
  const filterLabel =
    summary.checkoutServiceIdsFilter == null
      ? "tous les ServiceId"
      : summary.checkoutServiceIdsFilter.join(", ");
  console.info(
    `[coursier/quote] ${label} — filtre: ${filterLabel} | brutes: ${summary.rawOfferCount} | checkout: ${summary.checkoutOfferCount} | exclues: ${summary.excludedOfferCount}`,
  );
  for (const offer of summary.offers) {
    console.info(
      `[coursier/quote]   ${offer.includedInCheckout ? "✓" : "✗"} ServiceId=${offer.serviceId} « ${offer.service} » | enlèvement ${offer.pickupStart} → ${offer.pickupEnd} | livraison ${offer.deliveryStart} → ${offer.deliveryEnd} | ${offer.priceHt} € HT`,
    );
  }
}
