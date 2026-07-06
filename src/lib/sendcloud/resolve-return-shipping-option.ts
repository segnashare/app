import type { SendcloudEnv } from "@/lib/sendcloud/config";
import {
  fetchSendcloudDeliveryOptions,
  pickSendcloudReturnRelayDeliveryOption,
} from "@/lib/sendcloud/dynamic-checkout";
import type { ReturnShippingOutboundContext } from "@/lib/sendcloud/resolve-return-shipping-outbound-context";
import {
  pickReturnShippingMethodId,
  resolveRelayShippingOptionCode,
} from "@/lib/sendcloud/shipping-options";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";

export type ResolveReturnShippingOptionResult =
  | { ok: true; code: string; strategy: string }
  | { ok: false; error: string };

/**
 * Retour panier : point relais hub Segna (transporteur fixe via env / panel, sans alignement aller).
 */
export async function resolveReturnShippingOptionCode(
  env: SendcloudEnv,
  outbound?: ReturnShippingOutboundContext | null,
): Promise<ResolveReturnShippingOptionResult> {
  const explicit = process.env.SENDCLOUD_SHIPPING_OPTION_RETURN?.trim();
  if (explicit) {
    return { ok: true, code: explicit, strategy: "env:SENDCLOUD_SHIPPING_OPTION_RETURN" };
  }

  const methodIdRaw = process.env.SENDCLOUD_SHIPPING_METHOD_RETURN_ID?.trim();
  const methodId = methodIdRaw ? parseInt(methodIdRaw, 10) : NaN;
  if (Number.isFinite(methodId) && methodId > 0) {
    const code = await resolveRelayShippingOptionCode(env, methodId);
    if (code) {
      return { ok: true, code, strategy: "env:SENDCLOUD_SHIPPING_METHOD_RETURN_ID" };
    }
    return {
      ok: false,
      error: `SENDCLOUD_SHIPPING_METHOD_RETURN_ID=${methodId} : code shipping_option introuvable.`,
    };
  }

  if (env.relayShippingMethodId) {
    const code = await resolveRelayShippingOptionCode(env, env.relayShippingMethodId);
    if (code) {
      return { ok: true, code, strategy: "env:SENDCLOUD_SHIPPING_METHOD_RELAY_ID" };
    }
  }

  const ctx = outbound ?? {};
  const hubPc = (ctx.hubPostalCode ?? "").replace(/\D/g, "").slice(0, 5);
  const weightGrams = ctx.weightGrams ?? exchangeShippingWeightGrams(1);

  if (env.checkoutConfigurationId && hubPc.length === 5) {
    const { options } = await fetchSendcloudDeliveryOptions(env, {
      toPostalCode: hubPc,
      toCountry: "FR",
      weightGrams,
      orderValueEur: 1,
    });
    const picked = pickSendcloudReturnRelayDeliveryOption(options);
    if (picked?.checkoutIdentifierValue) {
      return {
        ok: true,
        code: picked.checkoutIdentifierValue,
        strategy: "default_relay:dynamic_checkout",
      };
    }
  }

  const panelMethodId = await pickReturnShippingMethodId(env);
  if (!panelMethodId) {
    return { ok: false, error: "Retour : aucune méthode point relais Sendcloud configurée." };
  }
  const panelCode = await resolveRelayShippingOptionCode(env, panelMethodId);
  if (!panelCode) {
    return { ok: false, error: "Retour : shipping_option_code introuvable (panel relais)." };
  }
  return { ok: true, code: panelCode, strategy: "default_relay:panel" };
}
