"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  computeExchangeRoundTripShippingCents,
  type ExchangeRoundTripShipping,
} from "@/lib/shipping/exchange-shipping-pricing";

export type CheckoutShippingPricingSource = "sendcloud" | "internal";

type QuoteApiRoundTrip = {
  outbound_cents: number;
  return_relay_cents: number;
  subtotal_cents: number;
};

function roundTripFromApi(row: QuoteApiRoundTrip): ExchangeRoundTripShipping {
  return {
    outboundCents: row.outbound_cents,
    returnRelayCents: row.return_relay_cents,
    subtotalCents: row.subtotal_cents,
  };
}

/**
 * Devis aller-retour relais + domicile (Sendcloud Dynamic Checkout ou barème interne).
 */
export function useSendcloudCheckoutShippingQuote(params: {
  itemCount: number;
  postalCode: string;
  relayOutboundOptionCode?: string | null;
  homeOutboundOptionCode?: string | null;
}): {
  livePricingEnabled: boolean;
  loading: boolean;
  pricingSource: CheckoutShippingPricingSource;
  relayRoundTrip: ExchangeRoundTripShipping;
  homeRoundTrip: ExchangeRoundTripShipping;
} {
  const itemCount = Math.min(Math.max(Math.floor(params.itemCount), 1), 10);
  const postalNorm = params.postalCode.replace(/\D/g, "").slice(0, 5);

  const internalRelay = useMemo(
    () => computeExchangeRoundTripShippingCents(itemCount, "relay"),
    [itemCount],
  );
  const internalHome = useMemo(
    () => computeExchangeRoundTripShippingCents(itemCount, "home"),
    [itemCount],
  );

  const [livePricingEnabled, setLivePricingEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pricingSource, setPricingSource] = useState<CheckoutShippingPricingSource>("internal");
  const [relayRoundTrip, setRelayRoundTrip] = useState(internalRelay);
  const [homeRoundTrip, setHomeRoundTrip] = useState(internalHome);

  useEffect(() => {
    setRelayRoundTrip(internalRelay);
    setHomeRoundTrip(internalHome);
  }, [internalRelay, internalHome]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/items/sendcloud/status");
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { checkout_live_pricing_enabled?: boolean };
        if (!cancelled) setLivePricingEnabled(Boolean(j.checkout_live_pricing_enabled));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchKeyRef = useRef("");

  useEffect(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!livePricingEnabled || postalNorm.length < 5) {
      setPricingSource("internal");
      setRelayRoundTrip(internalRelay);
      setHomeRoundTrip(internalHome);
      setLoading(false);
      return;
    }

    const relayOpt = (params.relayOutboundOptionCode ?? "").trim();
    const homeOpt = (params.homeOutboundOptionCode ?? "").trim();
    const fetchKey = `${itemCount}|${postalNorm}|${relayOpt}|${homeOpt}`;
    fetchKeyRef.current = fetchKey;
    setLoading(true);

    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/items/sendcloud/shipping-quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope: "both",
              item_count: itemCount,
              postal_code: postalNorm,
              country: "FR",
              relay_outbound_option_code: relayOpt || undefined,
              home_outbound_option_code: homeOpt || undefined,
            }),
          });
          if (fetchKeyRef.current !== fetchKey) return;

          const j = (await res.json()) as {
            source?: string;
            relay_round_trip?: QuoteApiRoundTrip;
            home_round_trip?: QuoteApiRoundTrip;
            error?: string;
          };

          if (!res.ok || !j.relay_round_trip || !j.home_round_trip) {
            setPricingSource("internal");
            setRelayRoundTrip(internalRelay);
            setHomeRoundTrip(internalHome);
            return;
          }

          setRelayRoundTrip(roundTripFromApi(j.relay_round_trip));
          setHomeRoundTrip(roundTripFromApi(j.home_round_trip));
          setPricingSource(j.source === "sendcloud" ? "sendcloud" : "internal");
        } catch {
          if (fetchKeyRef.current !== fetchKey) return;
          setPricingSource("internal");
          setRelayRoundTrip(internalRelay);
          setHomeRoundTrip(internalHome);
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
  }, [
    internalHome,
    internalRelay,
    itemCount,
    livePricingEnabled,
    postalNorm,
    params.homeOutboundOptionCode,
    params.relayOutboundOptionCode,
  ]);

  return {
    livePricingEnabled,
    loading,
    pricingSource,
    relayRoundTrip,
    homeRoundTrip,
  };
}
