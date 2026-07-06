import type { ExchangeOutboundMode } from "@/lib/shipping/exchange-shipping-pricing";
import {
  computeExchangeRoundTripShippingCents,
  exchangeShippingWeightGrams,
} from "@/lib/shipping/exchange-shipping-pricing";

import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { fetchCheckoutRelaySendcloudPricing } from "@/lib/sendcloud/checkout-relay-delivery-options";
import {
  fetchCheckoutHomeSendcloudPricing,
  pickCheckoutHomeMethodOption,
} from "@/lib/sendcloud/checkout-home-delivery-options";
import {
  getCheckoutHomeChronopostMethodId,
  getCheckoutHomeDomesticMethodId,
} from "@/lib/sendcloud/config";
import {
  fetchSendcloudDeliveryOptions,
  findSendcloudDeliveryOptionByCode,
  pickSendcloudDeliveryOption,
  pickSendcloudReturnRelayDeliveryOption,
  type SendcloudDeliveryOption,
} from "@/lib/sendcloud/dynamic-checkout";
import { getSegnaLogisticsHubFromEnv } from "@/lib/sendcloud/logistics-hub";

export type SendcloudRoundTripQuote = {
  source: "sendcloud" | "internal";
  outboundCents: number;
  returnRelayCents: number;
  subtotalCents: number;
  weightGrams: number;
  outboundOption: SendcloudDeliveryOption | null;
  returnOption: SendcloudDeliveryOption | null;
  errors: string[];
};

function optionHtCents(o: SendcloudDeliveryOption | null, fallback: number): number {
  const ht = o?.shippingRateCents;
  if (ht != null && ht > 0) return ht;
  return fallback;
}

/**
 * Devis aller + retour relais via Dynamic Checkout.
 * Retour : tarif relais vers le CP hub logistique (pas le CP membre).
 */
export async function quoteSendcloudRoundTripShipping(
  env: SendcloudEnv,
  params: {
    itemCount: number;
    outboundMode: ExchangeOutboundMode;
    memberPostalCode: string;
    memberCountry?: string;
    orderValueEur?: number;
    /** Choix membre au checkout (`checkoutIdentifierValue`). */
    outboundOptionCode?: string | null;
  },
): Promise<SendcloudRoundTripQuote> {
  const n = Math.min(Math.max(Math.floor(params.itemCount), 1), 10);
  const internal = computeExchangeRoundTripShippingCents(n, params.outboundMode);
  const weightGrams = exchangeShippingWeightGrams(n);
  const orderValueEur = params.orderValueEur ?? 0;
  const memberPc = params.memberPostalCode.replace(/\D/g, "").slice(0, 5);
  const memberCountry = (params.memberCountry ?? "FR").toUpperCase().slice(0, 2) || "FR";
  const hub = getSegnaLogisticsHubFromEnv();

  const errors: string[] = [];

  if (!env.checkoutConfigurationId) {
    return {
      source: "internal",
      outboundCents: internal.outboundCents,
      returnRelayCents: internal.returnRelayCents,
      subtotalCents: internal.subtotalCents,
      weightGrams,
      outboundOption: null,
      returnOption: null,
      errors: ["SENDCLOUD_CHECKOUT_CONFIGURATION_ID manquant — barème interne."],
    };
  }

  if (memberPc.length < 5) {
    return {
      source: "internal",
      outboundCents: internal.outboundCents,
      returnRelayCents: internal.returnRelayCents,
      subtotalCents: internal.subtotalCents,
      weightGrams,
      outboundOption: null,
      returnOption: null,
      errors: ["Code postal membre invalide — barème interne."],
    };
  }

  if (params.outboundMode === "relay") {
    const relay = await fetchCheckoutRelaySendcloudPricing(env, {
      itemCount: n,
      memberPostalCode: memberPc,
      memberCountry,
      orderValueEur,
    });
    if (relay.ok) {
      return {
        source: "sendcloud",
        outboundCents: relay.pricing.outboundHtCents,
        returnRelayCents: relay.pricing.returnHtCents,
        subtotalCents: relay.pricing.bundledRoundTripHtCents,
        weightGrams: relay.weightGrams,
        outboundOption: null,
        returnOption: null,
        errors,
      };
    }
    errors.push(relay.error);
    return {
      source: "internal",
      outboundCents: internal.outboundCents,
      returnRelayCents: internal.returnRelayCents,
      subtotalCents: internal.subtotalCents,
      weightGrams,
      outboundOption: null,
      returnOption: null,
      errors,
    };
  }

  const hasHomeMethods =
    Boolean(getCheckoutHomeChronopostMethodId(env)) || Boolean(getCheckoutHomeDomesticMethodId(env));

  if (hasHomeMethods) {
    const home = await fetchCheckoutHomeSendcloudPricing(env, {
      itemCount: n,
      memberPostalCode: memberPc,
      memberCountry,
      orderValueEur,
    });
    if (home.ok) {
      const picked = pickCheckoutHomeMethodOption(home.pricing, params.outboundOptionCode);
      if (picked) {
        return {
          source: "sendcloud",
          outboundCents: picked.outboundHtCents,
          returnRelayCents: picked.returnHtCents,
          subtotalCents: picked.bundledRoundTripHtCents,
          weightGrams: home.weightGrams,
          outboundOption: null,
          returnOption: null,
          errors,
        };
      }
      if (params.outboundOptionCode?.trim()) {
        errors.push("Option domicile invalide pour ce code postal.");
      }
    } else {
      errors.push(home.error);
    }
    return {
      source: "internal",
      outboundCents: internal.outboundCents,
      returnRelayCents: internal.returnRelayCents,
      subtotalCents: internal.subtotalCents,
      weightGrams,
      outboundOption: null,
      returnOption: null,
      errors,
    };
  }

  const outboundFetch = await fetchSendcloudDeliveryOptions(env, {
    toPostalCode: memberPc,
    toCountry: memberCountry,
    weightGrams,
    orderValueEur,
  });
  if (outboundFetch.error) errors.push(outboundFetch.error);

  const returnPc = hub?.postalCode ?? memberPc;
  const returnCountry = hub?.country ?? memberCountry;
  const returnFetch = await fetchSendcloudDeliveryOptions(env, {
    toPostalCode: returnPc,
    toCountry: returnCountry,
    weightGrams,
    orderValueEur,
  });
  if (returnFetch.error) errors.push(returnFetch.error);

  const selectedCode = params.outboundOptionCode?.trim() ?? "";
  let outboundOption: SendcloudDeliveryOption | null;
  if (selectedCode.length > 0) {
    outboundOption = findSendcloudDeliveryOptionByCode(
      outboundFetch.options,
      "home",
      selectedCode,
    );
    if (!outboundOption) {
      errors.push("Option d’expédition aller invalide pour ce code postal.");
      return {
        source: "internal",
        outboundCents: internal.outboundCents,
        returnRelayCents: internal.returnRelayCents,
        subtotalCents: internal.subtotalCents,
        weightGrams,
        outboundOption: null,
        returnOption: null,
        errors,
      };
    }
  } else {
    outboundOption = pickSendcloudDeliveryOption(outboundFetch.options, "home");
  }
  const returnOption = pickSendcloudReturnRelayDeliveryOption(returnFetch.options);

  const hasDcRates =
    outboundOption?.shippingRateCents != null && returnOption?.shippingRateCents != null;

  if (!hasDcRates) {
    if (!outboundOption?.shippingRateCents) {
      errors.push("Tarif Sendcloud aller indisponible.");
    }
    if (!returnOption?.shippingRateCents) {
      errors.push("Tarif Sendcloud retour relais indisponible.");
    }
    return {
      source: "internal",
      outboundCents: internal.outboundCents,
      returnRelayCents: internal.returnRelayCents,
      subtotalCents: internal.subtotalCents,
      weightGrams,
      outboundOption,
      returnOption,
      errors,
    };
  }

  const outboundCents = optionHtCents(outboundOption, internal.outboundCents);
  const returnRelayCents = optionHtCents(returnOption, internal.returnRelayCents);

  return {
    source: "sendcloud",
    outboundCents,
    returnRelayCents,
    subtotalCents: outboundCents + returnRelayCents,
    weightGrams,
    outboundOption,
    returnOption,
    errors,
  };
}
