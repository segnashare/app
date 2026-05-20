import {
  getCheckoutHomeChronopostMethodId,
  getCheckoutHomeChronopostMethodTitle,
  getCheckoutHomeDomesticMethodId,
  getCheckoutHomeDomesticMethodTitle,
  type SendcloudEnv,
} from "@/lib/sendcloud/config";
import {
  isSendcloudCheckoutDebugEnabled,
  logSendcloudCheckout,
  serializeSendcloudOptionForDebug,
} from "@/lib/sendcloud/checkout-debug";
import { sendcloudOptionRateHtTtc } from "@/lib/sendcloud/checkout-relay-delivery-options";
import type { SendcloudDeliveryOption } from "@/lib/sendcloud/dynamic-checkout";

import type { CheckoutHomeMethodKey } from "@/lib/sendcloud/checkout-home-delivery-options";

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function isHomeDeliveryMethodType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("home") || t === "standard_delivery" || t.includes("door");
}

export type HomeMethodMatchDiagnostic = {
  method_key: CheckoutHomeMethodKey;
  env_method_id: string;
  env_title_needle: string;
  found: boolean;
  match_reason: string | null;
  matched_option: Record<string, unknown> | null;
  candidates_home_with_rate: Record<string, unknown>[];
  candidates_all: Record<string, unknown>[];
};

export function diagnoseCheckoutHomeMethodMatch(
  options: SendcloudDeliveryOption[],
  env: SendcloudEnv,
  key: CheckoutHomeMethodKey,
): HomeMethodMatchDiagnostic {
  const envMethodId =
    key === "chronopost"
      ? getCheckoutHomeChronopostMethodId(env)
      : getCheckoutHomeDomesticMethodId(env);
  const envTitleNeedle = norm(
    key === "chronopost"
      ? getCheckoutHomeChronopostMethodTitle(env)
      : getCheckoutHomeDomesticMethodTitle(env),
  );

  const candidatesAll = options.map(serializeSendcloudOptionForDebug);
  const withRate = options.filter((o) => sendcloudOptionRateHtTtc(o) != null);
  const homeWithRate = withRate.filter((o) => isHomeDeliveryMethodType(o.deliveryMethodType));

  const diag: HomeMethodMatchDiagnostic = {
    method_key: key,
    env_method_id: envMethodId,
    env_title_needle: envTitleNeedle,
    found: false,
    match_reason: null,
    matched_option: null,
    candidates_home_with_rate: homeWithRate.map(serializeSendcloudOptionForDebug),
    candidates_all: candidatesAll,
  };

  if (envMethodId) {
    const id = envMethodId.toLowerCase();
    const byId = homeWithRate.find(
      (o) => o.id.toLowerCase() === id || o.checkoutIdentifierValue.toLowerCase() === id,
    );
    if (byId) {
      diag.found = true;
      diag.match_reason = "id_or_option_code";
      diag.matched_option = serializeSendcloudOptionForDebug(byId);
      return diag;
    }
    const byIdAnyType = withRate.find(
      (o) => o.id.toLowerCase() === id || o.checkoutIdentifierValue.toLowerCase() === id,
    );
    if (byIdAnyType && !isHomeDeliveryMethodType(byIdAnyType.deliveryMethodType)) {
      diag.match_reason = `id_found_but_not_home_type (type=${byIdAnyType.deliveryMethodType})`;
    }
  }

  if (envTitleNeedle) {
    const byTitle = homeWithRate.find((o) => norm(o.title).includes(envTitleNeedle));
    if (byTitle) {
      diag.found = true;
      diag.match_reason = "title";
      diag.matched_option = serializeSendcloudOptionForDebug(byTitle);
      return diag;
    }
  }

  if (!diag.match_reason) {
    if (homeWithRate.length === 0 && withRate.length > 0) {
      diag.match_reason = "no_home_type_in_api_response (only relay/other types returned)";
    } else if (options.length === 0) {
      diag.match_reason = "api_returned_zero_options";
    } else if (homeWithRate.length === 0) {
      diag.match_reason = "no_option_with_home_delivery_method_type_and_rate";
    } else {
      diag.match_reason = "env_id_and_title_no_match_among_home_options";
    }
  }

  return diag;
}

export type CheckoutHomeFetchDebugReport = {
  checkout_configuration_id: string;
  request: {
    postal_code: string;
    country: string;
    weight_grams: number;
    item_count: number;
    order_value_eur: number;
  };
  api: {
    option_count: number;
    options: Record<string, unknown>[];
    home_type_count: number;
    relay_type_count: number;
    fetch_error: string | null;
  };
  env: {
    chronopost_method_id: string;
    chronopost_title: string;
    domestic_method_id: string;
    domestic_title: string;
  };
  matching: HomeMethodMatchDiagnostic[];
  relay_return: { ok: boolean; error?: string };
  resolved_method_count: number;
};

export function buildCheckoutHomeFetchDebugReport(args: {
  env: SendcloudEnv;
  params: {
    itemCount: number;
    memberPostalCode: string;
    memberCountry: string;
    orderValueEur: number;
    weightGrams: number;
  };
  outboundFetched: { options: SendcloudDeliveryOption[]; error?: string };
  relayReturn: { ok: boolean; error?: string };
  methodOptionsCount: number;
}): CheckoutHomeFetchDebugReport {
  const options = args.outboundFetched.options;
  const homeTypeCount = options.filter((o) =>
    isHomeDeliveryMethodType(o.deliveryMethodType),
  ).length;

  return {
    checkout_configuration_id: args.env.checkoutConfigurationId ?? "(missing)",
    request: {
      postal_code: args.params.memberPostalCode,
      country: args.params.memberCountry,
      weight_grams: args.params.weightGrams,
      item_count: args.params.itemCount,
      order_value_eur: args.params.orderValueEur,
    },
    api: {
      option_count: options.length,
      options: options.map(serializeSendcloudOptionForDebug),
      home_type_count: homeTypeCount,
      relay_type_count: options.length - homeTypeCount,
      fetch_error: args.outboundFetched.error ?? null,
    },
    env: {
      chronopost_method_id: getCheckoutHomeChronopostMethodId(args.env),
      chronopost_title: getCheckoutHomeChronopostMethodTitle(args.env),
      domestic_method_id: getCheckoutHomeDomesticMethodId(args.env),
      domestic_title: getCheckoutHomeDomesticMethodTitle(args.env),
    },
    matching: (["chronopost", "domestic"] as const).map((key) =>
      diagnoseCheckoutHomeMethodMatch(options, args.env, key),
    ),
    relay_return: args.relayReturn,
    resolved_method_count: args.methodOptionsCount,
  };
}

export function emitCheckoutHomeFetchDebug(
  scope: string,
  report: CheckoutHomeFetchDebugReport,
): void {
  logSendcloudCheckout(scope, report);
}

export function shouldAttachCheckoutDebugToApiResponse(): boolean {
  return isSendcloudCheckoutDebugEnabled();
}
