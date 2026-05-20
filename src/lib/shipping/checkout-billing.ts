import { htToVatAndTtcCents } from "@/lib/cart/cart-checkout-vat";
import {
  computeExchangeRoundTripShippingCents,
  type ExchangeOutboundMode,
  type ExchangeRoundTripShipping,
} from "@/lib/shipping/exchange-shipping-pricing";

/**
 * Tarification checkout membre : barème Segna (aller + retour relais inclus).
 * Les tarifs affichés Sendcloud Dynamic Checkout ne sont pas utilisés pour la facturation.
 *
 * `SENDCLOUD_CHECKOUT_LIVE_PRICING=1` réactive l’ancien mode (tarifs DC Sendcloud).
 */
export function isCheckoutBillingSegnaGrid(): boolean {
  return process.env.SENDCLOUD_CHECKOUT_LIVE_PRICING !== "1";
}

export function segnaBundledRoundTripQuote(
  itemCount: number,
  outboundMode: ExchangeOutboundMode,
): ExchangeRoundTripShipping & { subtotalTtcCents: number } {
  const rt = computeExchangeRoundTripShippingCents(itemCount, outboundMode);
  const { ttcCents } = htToVatAndTtcCents(rt.subtotalCents);
  return { ...rt, subtotalTtcCents: ttcCents };
}
