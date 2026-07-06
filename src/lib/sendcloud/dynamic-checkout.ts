import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";
import {
  deliveryEtaFromSendcloudRaw,
  parseSendcloudShippingRateCents,
  type SendcloudDeliveryEta,
} from "@/lib/sendcloud/delivery-option-present";

export type SendcloudDeliveryOption = {
  id: string;
  title: string;
  description: string | null;
  deliveryMethodType: string;
  checkoutIdentifierType: string;
  checkoutIdentifierValue: string;
  shippingRateCents: number | null;
  currency: string;
  carrierCode: string;
  carrierName: string;
  carrierLogoUrl: string | null;
  deliveryEta: SendcloudDeliveryEta;
};

type RawDeliveryOptionsResponse = {
  configuration_id?: string;
  delivery_options?: RawDeliveryOption[];
};

type RawDeliveryOption = {
  id?: string;
  title?: string;
  description?: string | null;
  delivery_method_type?: string;
  checkout_identifier?: { type?: string; value?: string };
  shipping_rate?: { value?: string | number | null; currency?: string };
  carrier?: { code?: string; name?: string; logo_url?: string };
  lead_time_hours?: {
    p50?: number;
    p60?: number;
    p70?: number;
    p80?: number;
    p90?: number;
    p95?: number;
  } | null;
  delivery_dates?: Array<{ delivery_date?: string; parcel_handover_date?: string }> | null;
};

export async function fetchSendcloudDeliveryOptions(
  env: SendcloudEnv,
  params: {
    toPostalCode: string;
    toCountry: string;
    weightGrams: number;
    orderValueEur: number;
    checkoutIdentifierType?: string;
  },
): Promise<{ options: SendcloudDeliveryOption[]; error?: string }> {
  const configId = env.checkoutConfigurationId;
  if (!configId) {
    return { options: [], error: "SENDCLOUD_CHECKOUT_CONFIGURATION_ID manquant." };
  }

  const qs = new URLSearchParams({
    weight_value: String(Math.max(1, Math.floor(params.weightGrams))),
    total_order_value: String(Math.max(0, params.orderValueEur)),
    from_country_code: env.fromCountry,
    to_country_code: params.toCountry.toUpperCase().slice(0, 2) || "FR",
    to_postal_code: params.toPostalCode.trim().slice(0, 15),
    checkout_identifier_type: params.checkoutIdentifierType ?? "shipping_option_code",
  });

  const res = await sendcloudPanelV3Fetch<RawDeliveryOptionsResponse>(
    env,
    `/checkout/configurations/${encodeURIComponent(configId)}/delivery-options?${qs.toString()}`,
    { method: "GET" },
  );

  if (!res.ok) {
    return { options: [], error: res.error };
  }

  const raw = res.data.delivery_options ?? [];
  const options: SendcloudDeliveryOption[] = [];

  for (const o of raw) {
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const checkoutValue = o.checkout_identifier?.value?.trim() ?? "";
    const checkoutType = o.checkout_identifier?.type?.trim() ?? "shipping_option_code";
    if (!id || !checkoutValue) continue;

    options.push({
      id,
      title: (o.title ?? "Livraison").trim(),
      description: o.description ?? null,
      deliveryMethodType: (o.delivery_method_type ?? "standard_delivery").trim(),
      checkoutIdentifierType: checkoutType,
      checkoutIdentifierValue: checkoutValue,
      shippingRateCents: parseSendcloudShippingRateCents(o.shipping_rate?.value),
      currency: (o.shipping_rate?.currency ?? "EUR").trim(),
      carrierCode: (o.carrier?.code ?? "").trim(),
      carrierName: (o.carrier?.name ?? "").trim(),
      carrierLogoUrl: o.carrier?.logo_url ?? null,
      deliveryEta: deliveryEtaFromSendcloudRaw({
        deliveryMethodType: o.delivery_method_type,
        leadTimeHours: o.lead_time_hours,
        deliveryDates: o.delivery_dates,
      }),
    });
  }

  return { options };
}

function isRelayDeliveryMethod(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("service_point") || t.includes("pickup") || t.includes("parcel_shop");
}

function isHomeDeliveryMethod(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("home") || t === "standard_delivery" || t.includes("door");
}

function cheapestPricedOption(options: SendcloudDeliveryOption[]): SendcloudDeliveryOption | null {
  let best: SendcloudDeliveryOption | null = null;
  let bestCents = Number.POSITIVE_INFINITY;
  for (const o of options) {
    if (o.shippingRateCents == null) continue;
    if (o.shippingRateCents < bestCents) {
      bestCents = o.shippingRateCents;
      best = o;
    }
  }
  return best;
}

export function filterSendcloudDeliveryOptions(
  options: SendcloudDeliveryOption[],
  channel: "relay" | "home",
): SendcloudDeliveryOption[] {
  return options.filter((o) =>
    channel === "relay" ? isRelayDeliveryMethod(o.deliveryMethodType) : isHomeDeliveryMethod(o.deliveryMethodType),
  );
}

export function pickSendcloudDeliveryOption(
  options: SendcloudDeliveryOption[],
  channel: "relay" | "home",
): SendcloudDeliveryOption | null {
  const filtered = filterSendcloudDeliveryOptions(options, channel);
  return cheapestPricedOption(filtered.length > 0 ? filtered : options);
}

function isLockerDeliveryOption(o: SendcloudDeliveryOption): boolean {
  const blob = `${o.title} ${o.description ?? ""} ${o.deliveryMethodType}`.toLowerCase();
  return blob.includes("locker");
}

function isHomeDomesticDeliveryOption(o: SendcloudDeliveryOption): boolean {
  const blob = `${o.title} ${o.description ?? ""} ${o.deliveryMethodType}`.toLowerCase();
  return /home|domicile|domestic|door/.test(blob);
}

/** Retour panier : point relais classique, pas Locker Delivery (souvent moins cher en DC). */
export function pickSendcloudReturnRelayDeliveryOption(
  options: SendcloudDeliveryOption[],
): SendcloudDeliveryOption | null {
  const relay = filterSendcloudDeliveryOptions(options, "relay");
  const pointRelais = relay.filter(
    (o) => !isLockerDeliveryOption(o) && !isHomeDomesticDeliveryOption(o),
  );
  if (pointRelais.length === 0) return null;
  return cheapestPricedOption(pointRelais);
}

export function findSendcloudDeliveryOptionByCode(
  options: SendcloudDeliveryOption[],
  channel: "relay" | "home",
  optionCode: string,
): SendcloudDeliveryOption | null {
  const code = optionCode.trim();
  if (!code) return null;
  const filtered = filterSendcloudDeliveryOptions(options, channel);
  const pool = filtered.length > 0 ? filtered : options;
  return pool.find((o) => o.checkoutIdentifierValue === code) ?? null;
}

/** ID méthode DC (panel → Copier l’ID de la méthode) ou `checkout_identifier.value`. */
export function findSendcloudDeliveryOptionByMethodId(
  options: SendcloudDeliveryOption[],
  methodId: string,
): SendcloudDeliveryOption | null {
  const id = methodId.trim().toLowerCase();
  if (!id) return null;
  return (
    options.find((o) => o.id.toLowerCase() === id) ||
    options.find((o) => o.checkoutIdentifierValue.toLowerCase() === id) ||
    null
  );
}

function carrierSlugMatchesOption(carrierSlug: string, optionCarrierCode: string): boolean {
  const slug = carrierSlug.trim().toLowerCase();
  const code = optionCarrierCode.trim().toLowerCase();
  if (!slug || !code) return false;
  if (slug === code) return true;
  if (slug === "chronopost") return code.includes("chrono");
  if (slug === "mondial_relay") return code.includes("mondial");
  if (slug === "colissimo") return code.includes("colissimo");
  return code.includes(slug) || slug.includes(code);
}

/** Option Dynamic Checkout alignée sur le transporteur aller (relais ou domicile). */
export function pickSendcloudDeliveryOptionForCarrier(
  options: SendcloudDeliveryOption[],
  channel: "relay" | "home",
  carrierSlug: string,
): SendcloudDeliveryOption | null {
  const slug = carrierSlug.trim().toLowerCase();
  if (!slug) return null;

  const channelFiltered = options.filter((o) =>
    channel === "relay" ? isRelayDeliveryMethod(o.deliveryMethodType) : isHomeDeliveryMethod(o.deliveryMethodType),
  );
  const pool = channelFiltered.length > 0 ? channelFiltered : options;
  const byCarrier = pool.filter((o) => carrierSlugMatchesOption(slug, o.carrierCode));
  if (byCarrier.length === 0) return null;
  return cheapestPricedOption(byCarrier);
}
