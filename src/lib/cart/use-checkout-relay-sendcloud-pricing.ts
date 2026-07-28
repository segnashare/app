"use client";

import { useEffect, useRef, useState } from "react";

import type { CheckoutRelayCarrierOption } from "@/lib/sendcloud/checkout-relay-delivery-options";
import type { CheckoutSendcloudOutboundOption } from "@/lib/cart/checkout-sendcloud-outbound-option";
import { writeCheckoutSendcloudOutboundOption } from "@/lib/cart/checkout-sendcloud-outbound-option";

export type CheckoutRelaySendcloudPricingRow = {
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

function pricingFromApi(raw: Record<string, unknown>): CheckoutRelaySendcloudPricingRow | null {
  const optionCode = typeof raw.option_code === "string" ? raw.option_code.trim() : "";
  const deliveryMethodId =
    typeof raw.delivery_method_id === "string" ? raw.delivery_method_id.trim() : "";
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

  const carrierOptions: CheckoutRelayCarrierOption[] = [];
  const rawCarriers = raw.carrier_options;
  if (Array.isArray(rawCarriers)) {
    for (const c of rawCarriers) {
      if (!c || typeof c !== "object") continue;
      const row = c as Record<string, unknown>;
      const carrierCode =
        (typeof row.carrier_code === "string"
          ? row.carrier_code
          : typeof row.carrierCode === "string"
            ? row.carrierCode
            : ""
        ).trim();
      const optionCodeRow =
        (typeof row.option_code === "string"
          ? row.option_code
          : typeof row.optionCode === "string"
            ? row.optionCode
            : ""
        ).trim();
      if (!carrierCode || !optionCodeRow) continue;
      carrierOptions.push({
        carrierCode,
        carrierName:
          typeof row.carrier_name === "string"
            ? row.carrier_name
            : typeof row.carrierName === "string"
              ? row.carrierName
              : carrierCode,
        optionCode: optionCodeRow,
        carrierLogoUrl:
          typeof row.carrier_logo_url === "string"
            ? row.carrier_logo_url
            : typeof row.carrierLogoUrl === "string"
              ? row.carrierLogoUrl
              : null,
      });
    }
  }

  return {
    deliveryMethodId: deliveryMethodId || optionCode,
    optionCode,
    title: typeof raw.title === "string" ? raw.title : "Livraison point relais",
    deliveryEtaLabel:
      typeof raw.delivery_eta_label === "string" && raw.delivery_eta_label.trim()
        ? raw.delivery_eta_label.trim()
        : null,
    outboundHtCents,
    outboundTtcCents,
    returnHtCents,
    returnTtcCents,
    bundledRoundTripHtCents,
    bundledRoundTripTtcCents,
    carrierOptions,
  };
}

export function toRelayCheckoutSendcloudOutboundOption(
  row: CheckoutRelaySendcloudPricingRow,
  carrierHint?: string | null,
): CheckoutSendcloudOutboundOption {
  const hint = (carrierHint ?? "").toLowerCase();
  const carrier =
    hint && row.carrierOptions.length > 0
      ? row.carrierOptions.find(
          (c) =>
            c.carrierCode.includes(hint) ||
            hint.includes(c.carrierCode) ||
            (hint.includes("mondial") && c.carrierCode.includes("mondial")),
        ) ?? row.carrierOptions[0]
      : row.carrierOptions[0];

  return {
    optionCode: carrier?.optionCode ?? row.optionCode,
    optionId: row.deliveryMethodId,
    title: row.title,
    carrierCode: carrier?.carrierCode ?? "",
    carrierName: carrier?.carrierName ?? "",
    shippingRateCents: row.outboundHtCents,
  };
}

export function useCheckoutRelaySendcloudPricing(params: {
  enabled: boolean;
  itemCount: number;
  postalCode: string;
}): {
  loading: boolean;
  error: string | null;
  pricing: CheckoutRelaySendcloudPricingRow | null;
  weightTierLabel: string | null;
} {
  const postalNorm = params.postalCode.replace(/\D/g, "").slice(0, 5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<CheckoutRelaySendcloudPricingRow | null>(null);
  const [weightTierLabel, setWeightTierLabel] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchKeyRef = useRef("");

  useEffect(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!params.enabled || postalNorm.length < 5) {
      setPricing(null);
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
              delivery_channel: "relay",
              country: "FR",
            }),
          });
          if (fetchKeyRef.current !== fetchKey) return;

          const j = (await res.json()) as {
            relay_pricing?: Record<string, unknown>;
            weight_tier_label?: string | null;
            error?: string;
          };

          if (!res.ok) {
            setPricing(null);
            setWeightTierLabel(null);
            setError(j.error ?? "Tarif relais indisponible.");
            return;
          }

          const row = j.relay_pricing ? pricingFromApi(j.relay_pricing) : null;
          setPricing(row);
          setWeightTierLabel(typeof j.weight_tier_label === "string" ? j.weight_tier_label : null);
          setError(row ? null : "Tarif Sendcloud indisponible pour ce colis.");

          if (row) {
            writeCheckoutSendcloudOutboundOption("relay", toRelayCheckoutSendcloudOutboundOption(row));
          }
        } catch {
          if (fetchKeyRef.current !== fetchKey) return;
          setPricing(null);
          setWeightTierLabel(null);
          setError("Impossible de charger le tarif relais.");
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

  return { loading, error, pricing, weightTierLabel };
}
