"use client";

import { useEffect, useRef, useState } from "react";

import type { CheckoutHomeMethodOption } from "@/lib/sendcloud/checkout-home-delivery-options";
import type { CheckoutSendcloudOutboundOption } from "@/lib/cart/checkout-sendcloud-outbound-option";
import type { SendcloudOutboundDeliveryOptionRow } from "@/lib/cart/use-sendcloud-outbound-delivery-options";

function methodOptionFromApi(raw: Record<string, unknown>): CheckoutHomeMethodOption | null {
  const optionCode = typeof raw.option_code === "string" ? raw.option_code.trim() : "";
  if (!optionCode) return null;
  const num = (k: string) => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const outboundHtCents = num("outbound_ht_cents");
  const outboundTtcCents = num("outbound_ttc_cents");
  const returnHtCents = num("return_ht_cents");
  const returnTtcCents = num("return_ttc_cents");
  const bundledRoundTripHtCents = num("bundled_round_trip_ht_cents");
  const bundledRoundTripTtcCents = num("bundled_round_trip_ttc_cents");
  if (
    outboundHtCents == null ||
    outboundTtcCents == null ||
    returnHtCents == null ||
    returnTtcCents == null ||
    bundledRoundTripHtCents == null ||
    bundledRoundTripTtcCents == null
  ) {
    return null;
  }
  const methodKey = raw.method_key === "chronopost" ? "chronopost" : "domestic";
  return {
    methodKey,
    deliveryMethodId: typeof raw.delivery_method_id === "string" ? raw.delivery_method_id : optionCode,
    optionCode,
    title: typeof raw.title === "string" ? raw.title : "Livraison à domicile",
    deliveryEtaLabel:
      typeof raw.delivery_eta_label === "string" && raw.delivery_eta_label.trim()
        ? raw.delivery_eta_label.trim()
        : null,
    carrierCode: typeof raw.carrier_code === "string" ? raw.carrier_code : "",
    carrierName: typeof raw.carrier_name === "string" ? raw.carrier_name : "",
    carrierLogoUrl: typeof raw.carrier_logo_url === "string" ? raw.carrier_logo_url : null,
    outboundHtCents,
    outboundTtcCents,
    returnHtCents,
    returnTtcCents,
    bundledRoundTripHtCents,
    bundledRoundTripTtcCents,
  };
}

export function homeMethodToOutboundOptionRow(
  row: CheckoutHomeMethodOption,
): SendcloudOutboundDeliveryOptionRow {
  return {
    id: row.deliveryMethodId,
    title: row.title,
    description: null,
    optionCode: row.optionCode,
    carrierCode: row.carrierCode,
    carrierName: row.carrierName,
    carrierLogoUrl: row.carrierLogoUrl,
    deliveryEtaLabel: row.deliveryEtaLabel,
    outboundHtCents: row.outboundHtCents,
    outboundTtcCents: row.outboundTtcCents,
    returnHtCents: row.returnHtCents,
    returnTtcCents: row.returnTtcCents,
    bundledRoundTripHtCents: row.bundledRoundTripHtCents,
    bundledRoundTripTtcCents: row.bundledRoundTripTtcCents,
  };
}

export function toHomeCheckoutSendcloudOutboundOption(
  row: CheckoutHomeMethodOption,
): CheckoutSendcloudOutboundOption {
  return {
    optionCode: row.optionCode,
    optionId: row.deliveryMethodId,
    title: row.title,
    carrierCode: row.carrierCode,
    carrierName: row.carrierName,
    shippingRateCents: row.outboundHtCents,
  };
}

export function useCheckoutHomeSendcloudPricing(params: {
  enabled: boolean;
  itemCount: number;
  postalCode: string;
}): {
  loading: boolean;
  error: string | null;
  methodOptions: CheckoutHomeMethodOption[];
  defaultOptionCode: string | null;
  returnHtCents: number | null;
  returnTtcCents: number | null;
  weightTierLabel: string | null;
} {
  const postalNorm = params.postalCode.replace(/\D/g, "").slice(0, 5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [methodOptions, setMethodOptions] = useState<CheckoutHomeMethodOption[]>([]);
  const [defaultOptionCode, setDefaultOptionCode] = useState<string | null>(null);
  const [returnHtCents, setReturnHtCents] = useState<number | null>(null);
  const [returnTtcCents, setReturnTtcCents] = useState<number | null>(null);
  const [weightTierLabel, setWeightTierLabel] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchKeyRef = useRef("");

  useEffect(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!params.enabled || postalNorm.length < 5) {
      setMethodOptions([]);
      setDefaultOptionCode(null);
      setReturnHtCents(null);
      setReturnTtcCents(null);
      setWeightTierLabel(null);
      setError(null);
      setLoading(false);
      return;
    }

    const fetchKey = `${params.itemCount}|${postalNorm}`;
    fetchKeyRef.current = fetchKey;
    setLoading(true);
    setError(null);

    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/items/sendcloud/delivery-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item_count: params.itemCount,
              postal_code: postalNorm,
              delivery_channel: "home",
              country: "FR",
            }),
          });
          if (fetchKeyRef.current !== fetchKey) return;

          const j = (await res.json()) as {
            home_pricing?: {
              method_options?: Record<string, unknown>[];
              default_option_code?: string | null;
              return_ht_cents?: number | null;
              return_ttc_cents?: number | null;
            };
            weight_tier_label?: string | null;
            error?: string;
            _debug?: unknown;
          };

          if (j._debug != null && process.env.NODE_ENV === "development") {
            console.group("[sendcloud-checkout] delivery-options home — détail");
            console.log(j._debug);
            console.groupEnd();
          }

          if (!res.ok) {
            setMethodOptions([]);
            setDefaultOptionCode(null);
            setReturnHtCents(
              typeof j.home_pricing?.return_ht_cents === "number" &&
                Number.isFinite(j.home_pricing.return_ht_cents)
                ? j.home_pricing.return_ht_cents
                : null,
            );
            setReturnTtcCents(
              typeof j.home_pricing?.return_ttc_cents === "number" &&
                Number.isFinite(j.home_pricing.return_ttc_cents)
                ? j.home_pricing.return_ttc_cents
                : null,
            );
            setWeightTierLabel(null);
            setError(null);
            return;
          }

          const rows = (j.home_pricing?.method_options ?? [])
            .map((raw) => methodOptionFromApi(raw))
            .filter((r): r is CheckoutHomeMethodOption => r != null);
          setMethodOptions(rows);
          const def =
            typeof j.home_pricing?.default_option_code === "string"
              ? j.home_pricing.default_option_code
              : rows[0]?.optionCode ?? null;
          setDefaultOptionCode(def);
          setReturnHtCents(
            typeof j.home_pricing?.return_ht_cents === "number" &&
              Number.isFinite(j.home_pricing.return_ht_cents)
              ? j.home_pricing.return_ht_cents
              : rows[0]?.returnHtCents ?? null,
          );
          setReturnTtcCents(
            typeof j.home_pricing?.return_ttc_cents === "number" &&
              Number.isFinite(j.home_pricing.return_ttc_cents)
              ? j.home_pricing.return_ttc_cents
              : rows[0]?.returnTtcCents ?? null,
          );
          setWeightTierLabel(typeof j.weight_tier_label === "string" ? j.weight_tier_label : null);
          setError(null);
        } catch {
          if (fetchKeyRef.current !== fetchKey) return;
          setMethodOptions([]);
          setDefaultOptionCode(null);
          setReturnHtCents(null);
          setReturnTtcCents(null);
          setWeightTierLabel(null);
          setError(null);
        } finally {
          if (fetchKeyRef.current === fetchKey) setLoading(false);
        }
      })();
    }, 400);

    return () => {
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [params.enabled, params.itemCount, postalNorm]);

  return {
    loading,
    error,
    methodOptions,
    defaultOptionCode,
    returnHtCents,
    returnTtcCents,
    weightTierLabel,
  };
}
