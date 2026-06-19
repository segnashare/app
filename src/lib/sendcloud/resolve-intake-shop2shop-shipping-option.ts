import type { SendcloudEnv } from "@/lib/sendcloud/config";
import {
  findCheckoutRelayDeliveryMethodOptions,
  pickCheckoutRelayOptionForCarrier,
} from "@/lib/sendcloud/checkout-relay-delivery-options";
import {
  fetchSendcloudDeliveryOptions,
  type SendcloudDeliveryOption,
} from "@/lib/sendcloud/dynamic-checkout";
import { sendcloudPanelFetch } from "@/lib/sendcloud/client";
import { resolveRelayShippingOptionCode } from "@/lib/sendcloud/shipping-options";
import { SEGNA_PARCEL_WEIGHT_GRAMS } from "@/lib/shipping/exchange-shipping-pricing";

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Transporteur du point relais hub à utiliser avec cette option Sendcloud. */
export function hubCarrierForIntakeShippingOption(shippingOptionCode: string): string {
  const blob = norm(shippingOptionCode);
  if (
    blob.includes("chronopost") ||
    blob.includes("shop2shop") ||
    blob.includes("shop_2_shop") ||
    blob.includes("shop-2-shop")
  ) {
    return "chronopost";
  }
  if (blob.includes("mondial")) return "mondial_relay";
  return "mondial_relay";
}

/** Chronopost Shop2Shop 0,5–1 kg (ou libellé équivalent Sendcloud). */
export function isShop2ShopHalfKgDeliveryOption(o: SendcloudDeliveryOption): boolean {
  const blob = norm(`${o.title} ${o.description ?? ""} ${o.carrierName}`);
  const shop = blob.includes("shop2shop") || blob.includes("shop 2 shop");
  const weight =
    blob.includes("0.5-1") ||
    blob.includes("0,5-1") ||
    blob.includes("0.5 - 1") ||
    blob.includes("0,5 - 1") ||
    /0[,.]5\s*[-–]\s*1\s*kg/.test(blob);
  return shop && weight;
}

async function pickShop2ShopMethodIdFromPanel(env: SendcloudEnv): Promise<number | null> {
  const res = await sendcloudPanelFetch<{ shipping_methods: { id: number; name?: string; carrier?: string }[] }>(
    env,
    "/shipping_methods?sender_address=all",
    { method: "GET" },
  );
  if (!res.ok) return null;

  const methods = res.data.shipping_methods ?? [];
  const hit = methods.find((m) => {
    const name = norm(String(m.name ?? ""));
    const carrier = norm(String(m.carrier ?? ""));
    return (
      (carrier.includes("chronopost") || name.includes("chronopost")) &&
      (name.includes("shop2shop") || name.includes("shop 2 shop")) &&
      (name.includes("0.5-1") || name.includes("0,5-1") || name.includes("0.5 - 1"))
    );
  });
  return hit?.id ?? null;
}

/**
 * Option Sendcloud pour envoi membre → hub Segna (Shop2Shop 0,5–1 kg).
 * `SENDCLOUD_SHIPPING_OPTION_INTAKE` prime ; sinon DC / méthodes panel.
 */
export async function resolveIntakeShop2ShopShippingOptionCode(
  env: SendcloudEnv,
  params: { hubPostalCode: string; memberPostalCode?: string },
): Promise<string | null> {
  const explicit = process.env.SENDCLOUD_SHIPPING_OPTION_INTAKE?.trim();
  if (explicit) return explicit;

  const hubPc = params.hubPostalCode.replace(/\D/g, "").slice(0, 5);
  const memberPc = (params.memberPostalCode ?? hubPc).replace(/\D/g, "").slice(0, 5);
  const toPc = memberPc.length === 5 ? memberPc : hubPc;

  if (env.checkoutConfigurationId && toPc.length === 5) {
    const { options } = await fetchSendcloudDeliveryOptions(env, {
      toPostalCode: toPc,
      toCountry: "FR",
      weightGrams: SEGNA_PARCEL_WEIGHT_GRAMS,
      orderValueEur: 1,
    });

    const relayPool = findCheckoutRelayDeliveryMethodOptions(options, env);
    const shopFromRelay = relayPool.find(isShop2ShopHalfKgDeliveryOption);
    if (shopFromRelay?.checkoutIdentifierValue) return shopFromRelay.checkoutIdentifierValue;

    const shopFromAll = options.find(isShop2ShopHalfKgDeliveryOption);
    if (shopFromAll?.checkoutIdentifierValue) return shopFromAll.checkoutIdentifierValue;

    const chrono = pickCheckoutRelayOptionForCarrier(relayPool, env, "chronopost");
    if (chrono && isShop2ShopHalfKgDeliveryOption(chrono)) {
      return chrono.checkoutIdentifierValue;
    }
  }

  const methodId = await pickShop2ShopMethodIdFromPanel(env);
  if (methodId) {
    return resolveRelayShippingOptionCode(env, methodId);
  }

  if (env.relayShippingOptionCode) return env.relayShippingOptionCode;
  return null;
}
