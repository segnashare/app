import {
  computeExchangeRoundTripShippingCents,
  type ExchangeRoundTripShipping,
} from "@/lib/shipping/exchange-shipping-pricing";

import type { IncludedExchangeShippingKind } from "./included-exchange-shipping";

export type CartCheckoutHomeSpeed = "standard" | "uber_direct";

/**
 * Part livraison HT (aller-retour échange) alignée panier paiement / session Stripe.
 * @param uberOutboundHtCents — requis si domicile + Uber (sinon erreur).
 */
export function computeCartCheckoutRoundTripShippingHtCents(args: {
  itemCount: number;
  deliveryChannel: "relay" | "home";
  homeSpeedBilling: CartCheckoutHomeSpeed;
  includedKind: IncludedExchangeShippingKind;
  relayRoundTrip: ExchangeRoundTripShipping;
  currentRoundTrip: ExchangeRoundTripShipping;
  uberOutboundHtCents: number | null;
}): number {
  if (args.includedKind === "member_all_modes") {
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
      return Math.max(
        0,
        args.uberOutboundHtCents + args.currentRoundTrip.returnRelayCents - args.relayRoundTrip.subtotalCents,
      );
    }
    return Math.max(0, args.currentRoundTrip.subtotalCents - args.relayRoundTrip.subtotalCents);
  }

  if (args.deliveryChannel === "home" && args.homeSpeedBilling === "uber_direct") {
    if (args.uberOutboundHtCents == null) {
      throw new Error("uber_outbound_ht_required");
    }
    return args.uberOutboundHtCents + args.currentRoundTrip.returnRelayCents;
  }

  return args.currentRoundTrip.subtotalCents;
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
