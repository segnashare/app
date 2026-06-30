import type { SendcloudEnv } from "@/lib/sendcloud/config";
import {
  fetchSendcloudDeliveryOptions,
  pickSendcloudDeliveryOptionForCarrier,
} from "@/lib/sendcloud/dynamic-checkout";
import {
  classifyReturnShippingRoute,
  inferOutboundRelayCarrierSlug,
  type ReturnShippingOutboundContext,
} from "@/lib/sendcloud/resolve-return-shipping-outbound-context";
import {
  pickReturnShippingMethodId,
  pickReturnShippingMethodIdForCarrier,
  resolveRelayShippingOptionCode,
} from "@/lib/sendcloud/shipping-options";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";

export type ResolveReturnShippingOptionResult =
  | { ok: true; code: string; strategy: string }
  | { ok: false; error: string };

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

  const ctx = outbound ?? {};
  const route = classifyReturnShippingRoute(ctx);

  if (route === "home_or_uber") {
    const methodIdChrono = await pickReturnShippingMethodIdForCarrier(env, "chronopost");
    if (!methodIdChrono) {
      return {
        ok: false,
        error:
          "Retour domicile/Uber : méthode Chronopost Shop2Shop 0,5–1 kg introuvable dans Sendcloud.",
      };
    }
    const code = await resolveRelayShippingOptionCode(env, methodIdChrono);
    if (!code) {
      return { ok: false, error: "Retour domicile/Uber : shipping_option_code Chronopost introuvable." };
    }
    return { ok: true, code, strategy: "home_or_uber:chronopost_shop2shop" };
  }

  const carrierSlug = inferOutboundRelayCarrierSlug(ctx);
  if (!carrierSlug) {
    const fallbackId = await pickReturnShippingMethodId(env);
    if (!fallbackId) {
      return {
        ok: false,
        error:
          "Retour relais : transporteur aller inconnu — définir SENDCLOUD_SHIPPING_OPTION_RETURN ou configurer le checkout.",
      };
    }
    const code = await resolveRelayShippingOptionCode(env, fallbackId);
    if (!code) {
      return { ok: false, error: "Retour relais : shipping_option_code fallback introuvable." };
    }
    return { ok: true, code, strategy: "relay:fallback_preference" };
  }

  const hubPc = (ctx.hubPostalCode ?? "").replace(/\D/g, "").slice(0, 5);
  const weightGrams = ctx.weightGrams ?? exchangeShippingWeightGrams(1);
  if (env.checkoutConfigurationId && hubPc.length === 5) {
    const { options } = await fetchSendcloudDeliveryOptions(env, {
      toPostalCode: hubPc,
      toCountry: "FR",
      weightGrams,
      orderValueEur: 1,
    });
    const picked = pickSendcloudDeliveryOptionForCarrier(options, "relay", carrierSlug);
    if (picked?.checkoutIdentifierValue) {
      return {
        ok: true,
        code: picked.checkoutIdentifierValue,
        strategy: `relay:dynamic_checkout:${carrierSlug}`,
      };
    }
  }

  const panelMethodId = await pickReturnShippingMethodIdForCarrier(env, carrierSlug);
  if (!panelMethodId) {
    return {
      ok: false,
      error: `Retour relais : aucune méthode Sendcloud pour le transporteur « ${carrierSlug} ».`,
    };
  }
  const panelCode = await resolveRelayShippingOptionCode(env, panelMethodId);
  if (!panelCode) {
    return {
      ok: false,
      error: `Retour relais : shipping_option_code introuvable pour « ${carrierSlug} ».`,
    };
  }
  return { ok: true, code: panelCode, strategy: `relay:panel:${carrierSlug}` };
}
