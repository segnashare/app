import { NextResponse } from "next/server";

import { isSendcloudCheckoutLivePricingEnabled } from "@/lib/sendcloud/config";
import { resolveCartCheckoutShippingRoundTrips } from "@/lib/sendcloud/resolve-cart-checkout-shipping-round-trips";
import { getSegnaLogisticsHubFromEnv } from "@/lib/sendcloud/logistics-hub";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function parseItemCount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return Math.floor(n);
}

function parseDeliveryChannel(raw: unknown): "relay" | "home" | null {
  if (raw === "relay" || raw === "home") return raw;
  return null;
}

function roundTripPayload(rt: {
  outboundCents: number;
  returnRelayCents: number;
  subtotalCents: number;
}) {
  return {
    outbound_cents: rt.outboundCents,
    return_relay_cents: rt.returnRelayCents,
    subtotal_cents: rt.subtotalCents,
  };
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const itemCount = parseItemCount(o.item_count);
  const scope = typeof o.scope === "string" ? o.scope.trim() : "";
  const deliveryChannel = parseDeliveryChannel(o.delivery_channel);
  const postalCode = typeof o.postal_code === "string" ? o.postal_code.trim() : "";
  const country =
    (typeof o.country === "string" ? o.country.trim().toUpperCase() : "") || "FR";
  const orderValueEur =
    typeof o.order_value_eur === "number"
      ? o.order_value_eur
      : typeof o.order_value_eur === "string"
        ? parseFloat(o.order_value_eur)
        : 0;

  if (itemCount == null) {
    return NextResponse.json({ error: "item_count requis (1–10)" }, { status: 400 });
  }
  if (postalCode.replace(/\D/g, "").length < 5) {
    return NextResponse.json({ error: "postal_code requis (5 chiffres)" }, { status: 400 });
  }

  const hub = getSegnaLogisticsHubFromEnv();
  const livePricingEnabled = isSendcloudCheckoutLivePricingEnabled();
  const weightGrams = exchangeShippingWeightGrams(itemCount);

  const relayOutboundOptionCode =
    typeof o.relay_outbound_option_code === "string" ? o.relay_outbound_option_code.trim() : "";
  const homeOutboundOptionCode =
    typeof o.home_outbound_option_code === "string" ? o.home_outbound_option_code.trim() : "";

  if (scope === "both") {
    const resolved = await resolveCartCheckoutShippingRoundTrips({
      itemCount,
      memberPostalCode: postalCode,
      memberCountry: country,
      orderValueEur: Number.isFinite(orderValueEur) ? Math.max(0, orderValueEur) : 0,
      relayOutboundOptionCode: relayOutboundOptionCode || null,
      homeOutboundOptionCode: homeOutboundOptionCode || null,
    });

    return NextResponse.json({
      source: resolved.pricingSource,
      live_pricing_enabled: livePricingEnabled,
      relay_round_trip: roundTripPayload(resolved.relayRoundTrip),
      home_round_trip: roundTripPayload(resolved.homeRoundTrip),
      weight_grams: weightGrams,
      hub_postal_code: hub?.postalCode ?? null,
    });
  }

  if (!deliveryChannel) {
    return NextResponse.json(
      { error: "delivery_channel requis (relay | home) ou scope=both" },
      { status: 400 },
    );
  }

  const resolved = await resolveCartCheckoutShippingRoundTrips({
    itemCount,
    memberPostalCode: postalCode,
    memberCountry: country,
    orderValueEur: Number.isFinite(orderValueEur) ? Math.max(0, orderValueEur) : 0,
    relayOutboundOptionCode:
      deliveryChannel === "relay" ? relayOutboundOptionCode || null : relayOutboundOptionCode || null,
    homeOutboundOptionCode:
      deliveryChannel === "home" ? homeOutboundOptionCode || null : homeOutboundOptionCode || null,
  });

  const current =
    deliveryChannel === "relay" ? resolved.relayRoundTrip : resolved.homeRoundTrip;

  return NextResponse.json({
    source: resolved.pricingSource,
    live_pricing_enabled: livePricingEnabled,
    outbound_cents: current.outboundCents,
    return_relay_cents: current.returnRelayCents,
    subtotal_cents: current.subtotalCents,
    relay_round_trip: roundTripPayload(resolved.relayRoundTrip),
    home_round_trip: roundTripPayload(resolved.homeRoundTrip),
    weight_grams: weightGrams,
    hub_postal_code: hub?.postalCode ?? null,
    ...(resolved.pricingSource === "internal" && !livePricingEnabled
      ? {
          errors: ["SENDCLOUD_CHECKOUT_LIVE_PRICING désactivé ou configuration manquante."],
        }
      : {}),
  });
}
