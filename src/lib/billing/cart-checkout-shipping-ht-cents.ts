import {
  computeExchangeRoundTripShippingCents,
  type ExchangeRoundTripShipping,
} from "@/lib/shipping/exchange-shipping-pricing";

import type { IncludedExchangeShippingKind } from "./included-exchange-shipping";

export type CartCheckoutHomeSpeed = "standard" | "uber_direct";

/**
 * Part livraison HT (aller-retour échange) alignée panier paiement / session Stripe.
 * @param uberOutboundHtCents — requis si domicile + Uber (sinon erreur).
 * @param outboundOnly — achat définitif : facturer l’aller uniquement (pas de retour colis).
 */
export function computeCartCheckoutRoundTripShippingHtCents(args: {
  itemCount: number;
  deliveryChannel: "relay" | "home";
  homeSpeedBilling: CartCheckoutHomeSpeed;
  includedKind: IncludedExchangeShippingKind;
  /** Livraison relais offerte si location ≥ 50 € ou achat ≥ 200 € (hors abonnement). */
  complementRelayFree?: boolean;
  relayRoundTrip: ExchangeRoundTripShipping;
  currentRoundTrip: ExchangeRoundTripShipping;
  uberOutboundHtCents: number | null;
  outboundOnly?: boolean;
}): number {
  const outboundOnly = args.outboundOnly === true;

  if (args.includedKind === "member_all_modes") {
    return 0;
  }

  if (args.complementRelayFree && args.deliveryChannel === "relay") {
    return 0;
  }

  if (args.includedKind === "guest_relay_round_trip_equivalent" && args.deliveryChannel === "relay") {
    return 0;
  }

  if (args.includedKind === "guest_relay_round_trip_equivalent" && args.deliveryChannel === "home") {
    if (args.homeSpeedBilling === "uber_direct") {
      if (args.uberOutboundHtCents == null) {
        throw new Error("uber_outbound_ht_required");
      }
      const relayReferenceCents = outboundOnly
        ? args.relayRoundTrip.outboundCents
        : args.relayRoundTrip.subtotalCents;
      const billableHomeCents = outboundOnly
        ? args.uberOutboundHtCents
        : args.uberOutboundHtCents + args.currentRoundTrip.returnRelayCents;
      return Math.max(0, billableHomeCents - relayReferenceCents);
    }
    const currentBillableCents = outboundOnly
      ? args.currentRoundTrip.outboundCents
      : args.currentRoundTrip.subtotalCents;
    const relayReferenceCents = outboundOnly
      ? args.relayRoundTrip.outboundCents
      : args.relayRoundTrip.subtotalCents;
    return Math.max(0, currentBillableCents - relayReferenceCents);
  }

  if (args.deliveryChannel === "home" && args.homeSpeedBilling === "uber_direct") {
    if (args.uberOutboundHtCents == null) {
      throw new Error("uber_outbound_ht_required");
    }
    return outboundOnly
      ? args.uberOutboundHtCents
      : args.uberOutboundHtCents + args.currentRoundTrip.returnRelayCents;
  }

  return outboundOnly ? args.currentRoundTrip.outboundCents : args.currentRoundTrip.subtotalCents;
}

/** Pré-calcul des barèmes relais / mode courant (évite divergences client / serveur). */
export function computeCartCheckoutShippingGrid(args: {
  itemCount: number;
  deliveryChannel: "relay" | "home";
}): { relayRoundTrip: ExchangeRoundTripShipping; currentRoundTrip: ExchangeRoundTripShipping } {
  const n = args.itemCount;
  const outboundMode = args.deliveryChannel === "relay" ? "relay" : "home";
  return {
    relayRoundTrip: computeExchangeRoundTripShippingCents(n, "relay"),
    currentRoundTrip: computeExchangeRoundTripShippingCents(n, outboundMode),
  };
}
