import {
  getCheckoutHomeChronopostMethodId,
  getCheckoutHomeChronopostMethodTitle,
  getCheckoutHomeDomesticMethodId,
  getCheckoutHomeDomesticMethodTitle,
  type SendcloudEnv,
} from "@/lib/sendcloud/config";
import {
  fetchCheckoutRelaySendcloudPricing,
  sendcloudOptionRateHtTtc,
} from "@/lib/sendcloud/checkout-relay-delivery-options";
import {
  fetchSendcloudDeliveryOptions,
  type SendcloudDeliveryOption,
} from "@/lib/sendcloud/dynamic-checkout";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";
import {
  buildCheckoutHomeFetchDebugReport,
  emitCheckoutHomeFetchDebug,
  type CheckoutHomeFetchDebugReport,
} from "@/lib/sendcloud/checkout-home-debug";

export type CheckoutHomeMethodKey = "chronopost" | "domestic";

export type CheckoutHomeMethodOption = {
  methodKey: CheckoutHomeMethodKey;
  deliveryMethodId: string;
  optionCode: string;
  title: string;
  deliveryEtaLabel: string | null;
  carrierCode: string;
  carrierName: string;
  carrierLogoUrl: string | null;
  outboundHtCents: number;
  outboundTtcCents: number;
  returnHtCents: number;
  returnTtcCents: number;
  bundledRoundTripHtCents: number;
  bundledRoundTripTtcCents: number;
};

export type CheckoutHomeSendcloudPricing = {
  methodOptions: CheckoutHomeMethodOption[];
  defaultOptionCode: string;
  returnHtCents: number;
  returnTtcCents: number;
};

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function isHomeDeliveryMethodType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("home") || t === "standard_delivery" || t.includes("door");
}

function methodConfig(
  env: SendcloudEnv,
  key: CheckoutHomeMethodKey,
): { methodId: string; titleNeedle: string; label: string } {
  if (key === "chronopost") {
    return {
      methodId: getCheckoutHomeChronopostMethodId(env),
      titleNeedle: norm(getCheckoutHomeChronopostMethodTitle(env)),
      label: "Chronopost",
    };
  }
  return {
    methodId: getCheckoutHomeDomesticMethodId(env),
    titleNeedle: norm(getCheckoutHomeDomesticMethodTitle(env)),
    label: "domicile standard",
  };
}

export function findCheckoutHomeMethodOption(
  options: SendcloudDeliveryOption[],
  env: SendcloudEnv,
  key: CheckoutHomeMethodKey,
): SendcloudDeliveryOption | null {
  const { methodId, titleNeedle } = methodConfig(env, key);
  const withRate = options.filter(
    (o) => isHomeDeliveryMethodType(o.deliveryMethodType) && sendcloudOptionRateHtTtc(o) != null,
  );

  if (methodId) {
    const id = methodId.toLowerCase();
    const byId = withRate.find(
      (o) => o.id.toLowerCase() === id || o.checkoutIdentifierValue.toLowerCase() === id,
    );
    if (byId) return byId;
  }

  if (titleNeedle) {
    const byTitle = withRate.find((o) => norm(o.title).includes(titleNeedle));
    if (byTitle) return byTitle;
  }

  return null;
}

function homeMethodOptionRow(
  key: CheckoutHomeMethodKey,
  outboundOption: SendcloudDeliveryOption,
  returnHtCents: number,
  returnTtcCents: number,
): CheckoutHomeMethodOption | null {
  const outbound = sendcloudOptionRateHtTtc(outboundOption);
  if (!outbound) return null;
  return {
    methodKey: key,
    deliveryMethodId: outboundOption.id,
    optionCode: outboundOption.checkoutIdentifierValue,
    title: outboundOption.title,
    deliveryEtaLabel: outboundOption.deliveryEta.label,
    carrierCode: outboundOption.carrierCode,
    carrierName: outboundOption.carrierName,
    carrierLogoUrl: outboundOption.carrierLogoUrl,
    outboundHtCents: outbound.htCents,
    outboundTtcCents: outbound.ttcCents,
    returnHtCents,
    returnTtcCents,
    bundledRoundTripHtCents: outbound.htCents + returnHtCents,
    bundledRoundTripTtcCents: outbound.ttcCents + returnTtcCents,
  };
}

export function pickCheckoutHomeMethodOption(
  pricing: CheckoutHomeSendcloudPricing,
  optionCode?: string | null,
): CheckoutHomeMethodOption | null {
  const code = optionCode?.trim();
  if (code) {
    return pricing.methodOptions.find((o) => o.optionCode === code) ?? null;
  }
  return (
    pricing.methodOptions.find((o) => o.methodKey === "domestic") ??
    pricing.methodOptions[0] ??
    null
  );
}

export async function fetchCheckoutHomeSendcloudPricing(
  env: SendcloudEnv,
  params: {
    itemCount: number;
    memberPostalCode: string;
    memberCountry?: string;
    orderValueEur?: number;
  },
): Promise<
  | { ok: true; weightGrams: number; pricing: CheckoutHomeSendcloudPricing; debug?: CheckoutHomeFetchDebugReport }
  | { ok: false; error: string; debug?: CheckoutHomeFetchDebugReport }
> {
  const pc = params.memberPostalCode.replace(/\D/g, "").slice(0, 5);
  if (pc.length < 5) {
    return { ok: false, error: "Code postal membre invalide." };
  }

  const weightGrams = exchangeShippingWeightGrams(params.itemCount);
  const country = (params.memberCountry ?? "FR").toUpperCase().slice(0, 2) || "FR";
  const orderValueEur = params.orderValueEur ?? 0;

  const [outboundFetched, relayReturn] = await Promise.all([
    fetchSendcloudDeliveryOptions(env, {
      toPostalCode: pc,
      toCountry: country,
      weightGrams,
      orderValueEur,
    }),
    fetchCheckoutRelaySendcloudPricing(env, {
      itemCount: params.itemCount,
      memberPostalCode: pc,
      memberCountry: country,
      orderValueEur,
    }),
  ]);

  const relayReturnSummary = relayReturn.ok
    ? { ok: true as const }
    : { ok: false as const, error: relayReturn.error };

  const buildDebug = (methodOptionsCount: number) =>
    buildCheckoutHomeFetchDebugReport({
      env,
      params: {
        itemCount: params.itemCount,
        memberPostalCode: pc,
        memberCountry: country,
        orderValueEur,
        weightGrams,
      },
      outboundFetched,
      relayReturn: relayReturnSummary,
      methodOptionsCount,
    });

  if (outboundFetched.error) {
    const debug = buildDebug(0);
    emitCheckoutHomeFetchDebug("home-fetch-api-error", debug);
    return { ok: false, error: outboundFetched.error, debug };
  }

  const returnHtCents = relayReturn.ok ? relayReturn.pricing.returnHtCents : 0;
  const returnTtcCents = relayReturn.ok ? relayReturn.pricing.returnTtcCents : 0;

  const methodOptions: CheckoutHomeMethodOption[] = [];
  for (const key of ["chronopost", "domestic"] as const) {
    const outboundOption = findCheckoutHomeMethodOption(outboundFetched.options, env, key);
    if (!outboundOption) continue;
    const row = homeMethodOptionRow(key, outboundOption, returnHtCents, returnTtcCents);
    if (row) methodOptions.push(row);
  }

  if (methodOptions.length === 0) {
    const configured = [
      getCheckoutHomeChronopostMethodId(env) ? `Chronopost (${getCheckoutHomeChronopostMethodTitle(env)})` : null,
      getCheckoutHomeDomesticMethodId(env) ? `domicile (${getCheckoutHomeDomesticMethodTitle(env)})` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const available = outboundFetched.options
      .filter((o) => isHomeDeliveryMethodType(o.deliveryMethodType))
      .map((o) => `"${o.title}" (${o.id.slice(0, 8)}…)`)
      .join(", ");
    const relayOnly = outboundFetched.options
      .filter((o) => !isHomeDeliveryMethodType(o.deliveryMethodType))
      .map((o) => o.title)
      .filter((t, i, a) => a.indexOf(t) === i)
      .join(", ");
    const debug = buildDebug(0);
    emitCheckoutHomeFetchDebug("home-fetch-no-methods", debug);
    return {
      ok: false,
      error:
        available.length > 0
          ? `Méthodes domicile introuvables (${configured}). Sendcloud propose : ${available}. Vérifie les IDs API (CHRONO_18 / HOME_DOMESTIC) dans .env.`
          : relayOnly.length > 0
            ? `Sendcloud ne propose que le relais pour l’instant (${relayOnly}) — les méthodes domicile (${configured}) ne remontent pas dans l’API. Vérifie qu’elles sont dans la config Dynamic Checkout publiée (même UUID que SENDCLOUD_CHECKOUT_CONFIGURATION_ID) et qu’elles sont bien des livraisons à domicile.`
            : `Aucune option Sendcloud pour cette adresse. Vérifie Dynamic Checkout et les méthodes domicile (${configured}).`,
      debug,
    };
  }

  const defaultOption =
    methodOptions.find((o) => o.methodKey === "domestic") ?? methodOptions[0]!;

  const debug = buildDebug(methodOptions.length);
  emitCheckoutHomeFetchDebug("home-fetch-ok", debug);

  return {
    ok: true,
    weightGrams,
    pricing: {
      methodOptions,
      defaultOptionCode: defaultOption.optionCode,
      returnHtCents,
      returnTtcCents,
    },
    debug,
  };
}

export async function resolveHomeCheckoutShippingRoundTrip(
  env: SendcloudEnv,
  params: { itemCount: number; postalCode: string; optionCode?: string | null },
): Promise<{
  outboundCents: number;
  returnRelayCents: number;
  subtotalCents: number;
  methodKey: CheckoutHomeMethodKey;
} | null> {
  const quotes = await fetchCheckoutHomeSendcloudPricing(env, {
    itemCount: params.itemCount,
    memberPostalCode: params.postalCode,
  });
  if (!quotes.ok) return null;

  const picked = pickCheckoutHomeMethodOption(quotes.pricing, params.optionCode);
  if (!picked) return null;

  return {
    outboundCents: picked.outboundHtCents,
    returnRelayCents: picked.returnHtCents,
    subtotalCents: picked.bundledRoundTripHtCents,
    methodKey: picked.methodKey,
  };
}
