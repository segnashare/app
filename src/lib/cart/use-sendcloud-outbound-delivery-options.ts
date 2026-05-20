"use client";

import { useEffect, useRef, useState } from "react";

import type { CheckoutSendcloudOutboundOption } from "@/lib/cart/checkout-sendcloud-outbound-option";
import type { CheckoutDeliveryChannel } from "@/lib/cart/checkout-delivery-storage";

export type SendcloudOutboundDeliveryOptionRow = {
  id: string;
  title: string;
  description: string | null;
  optionCode: string;
  carrierCode: string;
  carrierName: string;
  carrierLogoUrl: string | null;
  deliveryEtaLabel: string | null;
  outboundHtCents: number | null;
  outboundTtcCents: number | null;
  returnHtCents: number | null;
  returnTtcCents: number | null;
  bundledRoundTripHtCents: number | null;
  bundledRoundTripTtcCents: number | null;
};

function rowFromApi(o: Record<string, unknown>): SendcloudOutboundDeliveryOptionRow | null {
  const optionCode = typeof o.option_code === "string" ? o.option_code.trim() : "";
  if (!optionCode) return null;
  return {
    id: typeof o.id === "string" ? o.id : optionCode,
    title: typeof o.title === "string" ? o.title : "Livraison",
    description: typeof o.description === "string" ? o.description : null,
    optionCode,
    carrierCode: typeof o.carrier_code === "string" ? o.carrier_code : "",
    carrierName: typeof o.carrier_name === "string" ? o.carrier_name : "",
    carrierLogoUrl: typeof o.carrier_logo_url === "string" ? o.carrier_logo_url : null,
    deliveryEtaLabel:
      typeof o.delivery_eta_label === "string" && o.delivery_eta_label.trim()
        ? o.delivery_eta_label.trim()
        : null,
    outboundHtCents:
      typeof o.outbound_ht_cents === "number" && Number.isFinite(o.outbound_ht_cents)
        ? o.outbound_ht_cents
        : null,
    outboundTtcCents:
      typeof o.outbound_ttc_cents === "number" && Number.isFinite(o.outbound_ttc_cents)
        ? o.outbound_ttc_cents
        : null,
    returnHtCents:
      typeof o.return_ht_cents === "number" && Number.isFinite(o.return_ht_cents)
        ? o.return_ht_cents
        : null,
    returnTtcCents:
      typeof o.return_ttc_cents === "number" && Number.isFinite(o.return_ttc_cents)
        ? o.return_ttc_cents
        : null,
    bundledRoundTripHtCents:
      typeof o.bundled_round_trip_ht_cents === "number" && Number.isFinite(o.bundled_round_trip_ht_cents)
        ? o.bundled_round_trip_ht_cents
        : null,
    bundledRoundTripTtcCents:
      typeof o.bundled_round_trip_ttc_cents === "number" && Number.isFinite(o.bundled_round_trip_ttc_cents)
        ? o.bundled_round_trip_ttc_cents
        : null,
  };
}

export function toCheckoutSendcloudOutboundOption(
  row: SendcloudOutboundDeliveryOptionRow,
): CheckoutSendcloudOutboundOption {
  return {
    optionCode: row.optionCode,
    optionId: row.id,
    title: row.title,
    carrierCode: row.carrierCode,
    carrierName: row.carrierName,
    shippingRateCents: row.outboundHtCents,
  };
}

export function useSendcloudOutboundDeliveryOptions(params: {
  enabled: boolean;
  itemCount: number;
  postalCode: string;
  deliveryChannel: CheckoutDeliveryChannel;
}): {
  loading: boolean;
  error: string | null;
  options: SendcloudOutboundDeliveryOptionRow[];
  defaultOptionCode: string | null;
  weightTierLabel: string | null;
  returnTtcCents: number | null;
} {
  const postalNorm = params.postalCode.replace(/\D/g, "").slice(0, 5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<SendcloudOutboundDeliveryOptionRow[]>([]);
  const [defaultOptionCode, setDefaultOptionCode] = useState<string | null>(null);
  const [weightTierLabel, setWeightTierLabel] = useState<string | null>(null);
  const [returnTtcCents, setReturnTtcCents] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchKeyRef = useRef("");

  useEffect(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!params.enabled || postalNorm.length < 5) {
      setOptions([]);
      setDefaultOptionCode(null);
      setWeightTierLabel(null);
      setReturnTtcCents(null);
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
            options?: Record<string, unknown>[];
            default_option_code?: string | null;
            weight_tier_label?: string | null;
            return_ttc_cents?: number | null;
            error?: string;
          };

          if (!res.ok) {
            setOptions([]);
            setDefaultOptionCode(null);
            setWeightTierLabel(null);
            setReturnTtcCents(null);
            setError(j.error ?? "Options de livraison indisponibles.");
            return;
          }

          const rows = (j.options ?? [])
            .map((raw) => rowFromApi(raw))
            .filter((r): r is SendcloudOutboundDeliveryOptionRow => r != null);
          setOptions(rows);
          setDefaultOptionCode(
            typeof j.default_option_code === "string" ? j.default_option_code : rows[0]?.optionCode ?? null,
          );
          setWeightTierLabel(typeof j.weight_tier_label === "string" ? j.weight_tier_label : null);
          setReturnTtcCents(
            typeof j.return_ttc_cents === "number" && Number.isFinite(j.return_ttc_cents)
              ? j.return_ttc_cents
              : rows[0]?.returnTtcCents ?? null,
          );
          setError(
            rows.length === 0
              ? "Aucune offre Shop2Shop / Mondial Relay — vérifie la config Sendcloud Dynamic Checkout."
              : null,
          );
        } catch {
          if (fetchKeyRef.current !== fetchKey) return;
          setOptions([]);
          setDefaultOptionCode(null);
          setWeightTierLabel(null);
          setReturnTtcCents(null);
          setError("Impossible de charger les offres de livraison.");
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

  return { loading, error, options, defaultOptionCode, weightTierLabel, returnTtcCents };
}
