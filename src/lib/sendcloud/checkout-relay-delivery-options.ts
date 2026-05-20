import { sendcloudShippingRateTtcCentsFromHt } from "@/lib/sendcloud/delivery-option-present";
import {
  getCheckoutRelayDeliveryMethodId,
  getCheckoutRelayDeliveryMethodTitle,
  type SendcloudEnv,
} from "@/lib/sendcloud/config";
import {
  fetchSendcloudDeliveryOptions,
  type SendcloudDeliveryOption,
} from "@/lib/sendcloud/dynamic-checkout";
import { getSegnaLogisticsHubFromEnv } from "@/lib/sendcloud/logistics-hub";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function isRelayDeliveryMethodType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("service_point") || t.includes("pickup") || t.includes("parcel_shop");
}

export type CheckoutRelayCarrierOption = {
  carrierCode: string;
  carrierName: string;
  optionCode: string;
};

export type CheckoutRelaySendcloudPricing = {
  deliveryMethodId: string;
  optionCode: string;
  title: string;
  deliveryEtaLabel: string | null;
  outboundHtCents: number;
  outboundTtcCents: number;
  returnHtCents: number;
  returnTtcCents: number;
  bundledRoundTripHtCents: number;
  bundledRoundTripTtcCents: number;
  carrierOptions: CheckoutRelayCarrierOption[];
};

/** Tarif HT panel Sendcloud + TTC pour affichage membre (facturation Stripe sur le HT). */
export function sendcloudOptionRateHtTtc(
  option: SendcloudDeliveryOption | null,
): { htCents: number; ttcCents: number } | null {
  if (!option) return null;
  const htCents = option.shippingRateCents;
  if (htCents == null || htCents <= 0) return null;
  return { htCents, ttcCents: sendcloudShippingRateTtcCentsFromHt(htCents) };
}

/**
 * Options DC pour « Livraison en Relais (Aller) ».
 * L’ID affiché dans le panel Sendcloud peut différer de `delivery_options[].id` après publication :
 * on matche d’abord par ID, puis par titre de méthode.
 */
export function findCheckoutRelayDeliveryMethodOptions(
  options: SendcloudDeliveryOption[],
  env: SendcloudEnv,
): SendcloudDeliveryOption[] {
  const methodId = getCheckoutRelayDeliveryMethodId(env).trim().toLowerCase();
  const titleNeedle = norm(getCheckoutRelayDeliveryMethodTitle(env));

  const withRate = options.filter(
    (o) => isRelayDeliveryMethodType(o.deliveryMethodType) && sendcloudOptionRateHtTtc(o) != null,
  );

  if (methodId) {
    const byId = withRate.filter(
      (o) => o.id.toLowerCase() === methodId || o.checkoutIdentifierValue.toLowerCase() === methodId,
    );
    if (byId.length > 0) return byId;
  }

  if (titleNeedle) {
    const byTitle = withRate.filter((o) => norm(o.title).includes(titleNeedle));
    if (byTitle.length > 0) return byTitle;
  }

  return [];
}

export function pickCheckoutRelayOptionForCarrier(
  options: SendcloudDeliveryOption[],
  env: SendcloudEnv,
  carrierHint?: string | null,
): SendcloudDeliveryOption | null {
  const pool = findCheckoutRelayDeliveryMethodOptions(options, env);
  if (pool.length === 0) return null;
  const hint = norm(carrierHint ?? "");
  if (!hint) return pool[0] ?? null;

  const match = pool.find((o) => {
    const c = norm(o.carrierCode);
    return c.includes(hint) || hint.includes(c) || (hint.includes("mondial") && c.includes("mondial"));
  });
  return match ?? pool[0] ?? null;
}

/** Aller + retour : même méthode DC ; si le retour n’est pas dans la réponse hub, on réutilise le tarif aller. */
export function checkoutRelayBundledPricing(
  outboundOption: SendcloudDeliveryOption,
  returnOption: SendcloudDeliveryOption | null,
  carrierOptions: CheckoutRelayCarrierOption[],
): CheckoutRelaySendcloudPricing | null {
  const outbound = sendcloudOptionRateHtTtc(outboundOption);
  if (!outbound) return null;
  const ret = sendcloudOptionRateHtTtc(returnOption) ?? outbound;

  return {
    deliveryMethodId: outboundOption.id,
    optionCode: outboundOption.checkoutIdentifierValue,
    title: outboundOption.title,
    deliveryEtaLabel: outboundOption.deliveryEta.label,
    outboundHtCents: outbound.htCents,
    outboundTtcCents: outbound.ttcCents,
    returnHtCents: ret.htCents,
    returnTtcCents: ret.ttcCents,
    bundledRoundTripHtCents: outbound.htCents + ret.htCents,
    bundledRoundTripTtcCents: outbound.ttcCents + ret.ttcCents,
    carrierOptions,
  };
}

function carrierOptionsFromPool(pool: SendcloudDeliveryOption[]): CheckoutRelayCarrierOption[] {
  const seen = new Set<string>();
  const out: CheckoutRelayCarrierOption[] = [];
  for (const o of pool) {
    const code = o.carrierCode.trim().toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({
      carrierCode: code,
      carrierName: o.carrierName,
      optionCode: o.checkoutIdentifierValue,
    });
  }
  return out;
}

export async function fetchCheckoutRelaySendcloudPricing(
  env: SendcloudEnv,
  params: {
    itemCount: number;
    memberPostalCode: string;
    memberCountry?: string;
    orderValueEur?: number;
  },
): Promise<
  | { ok: true; weightGrams: number; pricing: CheckoutRelaySendcloudPricing }
  | { ok: false; error: string }
> {
  const pc = params.memberPostalCode.replace(/\D/g, "").slice(0, 5);
  if (pc.length < 5) {
    return { ok: false, error: "Code postal membre invalide." };
  }

  const weightGrams = exchangeShippingWeightGrams(params.itemCount);
  const country = (params.memberCountry ?? "FR").toUpperCase().slice(0, 2) || "FR";
  const orderValueEur = params.orderValueEur ?? 0;
  const hub = getSegnaLogisticsHubFromEnv();
  const returnPc = hub?.postalCode?.replace(/\D/g, "").slice(0, 5) ?? pc;
  const methodTitle = getCheckoutRelayDeliveryMethodTitle(env);

  const [outboundFetched, returnFetched] = await Promise.all([
    fetchSendcloudDeliveryOptions(env, {
      toPostalCode: pc,
      toCountry: country,
      weightGrams,
      orderValueEur,
    }),
    fetchSendcloudDeliveryOptions(env, {
      toPostalCode: returnPc,
      toCountry: hub?.country ?? country,
      weightGrams,
      orderValueEur,
    }),
  ]);

  if (outboundFetched.error) {
    return { ok: false, error: outboundFetched.error };
  }
  if (returnFetched.error) {
    return { ok: false, error: returnFetched.error };
  }

  const outboundPool = findCheckoutRelayDeliveryMethodOptions(outboundFetched.options, env);
  const outboundOption = outboundPool[0] ?? null;
  if (!outboundOption) {
    const available = outboundFetched.options
      .filter((o) => isRelayDeliveryMethodType(o.deliveryMethodType))
      .map((o) => `"${o.title}" (${o.id.slice(0, 8)}…)`)
      .join(", ");
    return {
      ok: false,
      error:
        available.length > 0
          ? `Méthode « ${methodTitle} » introuvable. Relais disponibles : ${available}. Vérifie SENDCLOUD_CHECKOUT_RELAY_DELIVERY_METHOD_TITLE ou l’ID API (pas l’ID du brouillon panel).`
          : `Méthode « ${methodTitle} » introuvable pour ce code postal — publie-la dans Dynamic Checkout.`,
    };
  }

  const returnOption = pickCheckoutRelayOptionForCarrier(returnFetched.options, env);
  const carrierOptions = carrierOptionsFromPool(outboundPool);
  const pricing = checkoutRelayBundledPricing(outboundOption, returnOption, carrierOptions);
  if (!pricing) {
    return {
      ok: false,
      error: "Tarif Sendcloud indisponible pour cette méthode et ce poids.",
    };
  }

  return { ok: true, weightGrams, pricing };
}

/** Facturation Stripe : tarifs de la méthode relais configurée (aller + retour). */
export async function resolveRelayCheckoutShippingRoundTrip(
  env: SendcloudEnv,
  params: { itemCount: number; postalCode: string; optionCode?: string | null },
): Promise<{
  outboundCents: number;
  returnRelayCents: number;
  subtotalCents: number;
} | null> {
  const quotes = await fetchCheckoutRelaySendcloudPricing(env, {
    itemCount: params.itemCount,
    memberPostalCode: params.postalCode,
  });
  if (!quotes.ok) return null;

  const code = params.optionCode?.trim();
  if (code) {
    const allowed = quotes.pricing.carrierOptions.some((c) => c.optionCode === code);
    if (!allowed && code !== quotes.pricing.optionCode) return null;
  }

  return {
    outboundCents: quotes.pricing.outboundHtCents,
    returnRelayCents: quotes.pricing.returnHtCents,
    subtotalCents: quotes.pricing.bundledRoundTripHtCents,
  };
}

export async function resolveRelayCheckoutShippingHtCents(
  env: SendcloudEnv,
  params: { itemCount: number; postalCode: string; optionCode?: string | null },
): Promise<number | null> {
  const trip = await resolveRelayCheckoutShippingRoundTrip(env, params);
  return trip?.subtotalCents ?? null;
}

export function resolveRelayOptionCodeForCarrier(
  pricing: CheckoutRelaySendcloudPricing,
  carrierHint?: string | null,
): string {
  const hint = norm(carrierHint ?? "");
  if (!hint) return pricing.optionCode;
  const match = pricing.carrierOptions.find((c) => {
    const code = norm(c.carrierCode);
    return code.includes(hint) || hint.includes(code);
  });
  return match?.optionCode ?? pricing.optionCode;
}
