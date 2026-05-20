import { quoteSendcloudRoundTripShipping } from "@/lib/sendcloud/checkout-pricing";
import { getSendcloudEnv, isSendcloudCheckoutLivePricingEnabled } from "@/lib/sendcloud/config";
import { isCheckoutBillingSegnaGrid, segnaBundledRoundTripQuote } from "@/lib/shipping/checkout-billing";
import type { ExchangeRoundTripShipping } from "@/lib/shipping/exchange-shipping-pricing";

export type CartCheckoutShippingPricingSource = "sendcloud" | "internal";

export async function resolveCartCheckoutShippingRoundTrips(params: {
  itemCount: number;
  memberPostalCode: string;
  memberCountry?: string;
  orderValueEur?: number;
  relayOutboundOptionCode?: string | null;
  homeOutboundOptionCode?: string | null;
}): Promise<{
  relayRoundTrip: ExchangeRoundTripShipping;
  homeRoundTrip: ExchangeRoundTripShipping;
  pricingSource: CartCheckoutShippingPricingSource;
}> {
  const n = Math.min(Math.max(Math.floor(params.itemCount), 1), 10);
  const internalRelay = segnaBundledRoundTripQuote(n, "relay");
  const internalHome = segnaBundledRoundTripQuote(n, "home");

  const pc = params.memberPostalCode.replace(/\D/g, "").slice(0, 5);
  if (isCheckoutBillingSegnaGrid() || !isSendcloudCheckoutLivePricingEnabled() || pc.length < 5) {
    return {
      relayRoundTrip: internalRelay,
      homeRoundTrip: internalHome,
      pricingSource: "internal",
    };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return {
      relayRoundTrip: internalRelay,
      homeRoundTrip: internalHome,
      pricingSource: "internal",
    };
  }

  const orderValueEur = Number.isFinite(params.orderValueEur) ? Math.max(0, params.orderValueEur!) : 0;
  const country = (params.memberCountry ?? "FR").toUpperCase().slice(0, 2) || "FR";

  const [relayQuote, homeQuote] = await Promise.all([
    quoteSendcloudRoundTripShipping(env, {
      itemCount: n,
      outboundMode: "relay",
      memberPostalCode: pc,
      memberCountry: country,
      orderValueEur,
      outboundOptionCode: params.relayOutboundOptionCode,
    }),
    quoteSendcloudRoundTripShipping(env, {
      itemCount: n,
      outboundMode: "home",
      memberPostalCode: pc,
      memberCountry: country,
      orderValueEur,
      outboundOptionCode: params.homeOutboundOptionCode,
    }),
  ]);

  const relayRoundTrip =
    relayQuote.source === "sendcloud"
      ? {
          outboundCents: relayQuote.outboundCents,
          returnRelayCents: relayQuote.returnRelayCents,
          subtotalCents: relayQuote.subtotalCents,
        }
      : internalRelay;

  const homeRoundTrip =
    homeQuote.source === "sendcloud"
      ? {
          outboundCents: homeQuote.outboundCents,
          returnRelayCents: homeQuote.returnRelayCents,
          subtotalCents: homeQuote.subtotalCents,
        }
      : internalHome;

  const pricingSource =
    relayQuote.source === "sendcloud" && homeQuote.source === "sendcloud" ? "sendcloud" : "internal";

  return { relayRoundTrip, homeRoundTrip, pricingSource };
}
