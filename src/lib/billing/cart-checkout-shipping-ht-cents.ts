import { htToVatAndTtcCents } from "@/lib/cart/cart-checkout-vat";
import { sendcloudShippingRateHtCentsFromTtc } from "@/lib/sendcloud/delivery-option-present";
import {
  computeExchangeRoundTripShippingCents,
  type ExchangeRoundTripShipping,
} from "@/lib/shipping/exchange-shipping-pricing";

import type { IncludedExchangeShippingKind } from "./included-exchange-shipping";

export type CartCheckoutHomeSpeed = "standard" | "uber_direct";

/** Plan Sendcloud domicile : Mondial Relay (= domestic) vs Chronopost. */
export type CartCheckoutHomePlanKind = "domestic" | "chronopost";

/**
 * Abattement TTC de l’échange inclus sur Express / Chrono uniquement.
 * Mondial Relay (domestic + point relais) reste entièrement offert.
 * Supplément = max(0, prix devis TTC − 10 €).
 */
export const INCLUDED_EXCHANGE_HOME_ALLOWANCE_TTC_CENTS = 1000;

/** HT facturable après abattement 10 € TTC sur un devis domicile. */
export function computeHomeShippingHtAfterIncludedAllowance(fullHomeHtCents: number): number {
  const fullHt = Math.max(0, Math.trunc(fullHomeHtCents));
  if (fullHt <= 0) return 0;
  const fullTtc = htToVatAndTtcCents(fullHt).ttcCents;
  const supplementTtc = Math.max(0, fullTtc - INCLUDED_EXCHANGE_HOME_ALLOWANCE_TTC_CENTS);
  return sendcloudShippingRateHtCentsFromTtc(supplementTtc);
}

/** Express + Chrono = supplément ; Mondial Relay domicile = offert comme le relais. */
export function homePlanUsesIncludedSupplement(
  homeSpeedBilling: CartCheckoutHomeSpeed,
  homePlanKind: CartCheckoutHomePlanKind | null | undefined,
): boolean {
  if (homeSpeedBilling === "uber_direct") return true;
  return homePlanKind === "chronopost";
}

function fullHomeRoundTripHtCents(args: {
  outboundOnly: boolean;
  homeSpeedBilling: CartCheckoutHomeSpeed;
  currentRoundTrip: ExchangeRoundTripShipping;
  uberOutboundHtCents: number | null;
}): number {
  if (args.homeSpeedBilling === "uber_direct") {
    if (args.uberOutboundHtCents == null) {
      throw new Error("uber_outbound_ht_required");
    }
    return args.outboundOnly
      ? args.uberOutboundHtCents
      : args.uberOutboundHtCents + args.currentRoundTrip.returnRelayCents;
  }
  return args.outboundOnly ? args.currentRoundTrip.outboundCents : args.currentRoundTrip.subtotalCents;
}

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
  /** Plan domicile Sendcloud (`domestic` = Mondial Relay, `chronopost` = Chrono). */
  homePlanKind?: CartCheckoutHomePlanKind | null;
  relayRoundTrip: ExchangeRoundTripShipping;
  currentRoundTrip: ExchangeRoundTripShipping;
  uberOutboundHtCents: number | null;
  outboundOnly?: boolean;
}): number {
  const outboundOnly = args.outboundOnly === true;

  if (args.includedKind === "member_all_modes") {
    // Relais + Mondial Relay domicile : offert. Express / Chrono : supplément = devis − 10 €.
    if (args.deliveryChannel === "relay") return 0;
    if (!homePlanUsesIncludedSupplement(args.homeSpeedBilling, args.homePlanKind)) {
      return 0;
    }
    const fullHomeHt = fullHomeRoundTripHtCents({
      outboundOnly,
      homeSpeedBilling: args.homeSpeedBilling,
      currentRoundTrip: args.currentRoundTrip,
      uberOutboundHtCents: args.uberOutboundHtCents,
    });
    return computeHomeShippingHtAfterIncludedAllowance(fullHomeHt);
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
    return fullHomeRoundTripHtCents({
      outboundOnly,
      homeSpeedBilling: "uber_direct",
      currentRoundTrip: args.currentRoundTrip,
      uberOutboundHtCents: args.uberOutboundHtCents,
    });
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
