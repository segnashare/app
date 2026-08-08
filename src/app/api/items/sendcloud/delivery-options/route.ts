import { NextResponse } from "next/server";

import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { SEGNA_PARCEL_WEIGHT_GRAMS } from "@/lib/shipping/exchange-shipping-pricing";
import { fetchCheckoutRelaySendcloudPricing } from "@/lib/sendcloud/checkout-relay-delivery-options";
import { fetchCheckoutHomeSendcloudPricing } from "@/lib/sendcloud/checkout-home-delivery-options";
import { shouldAttachCheckoutDebugToApiResponse } from "@/lib/sendcloud/checkout-home-debug";
import { resolveRequestUser } from "@/lib/supabase/request-user";

function parseItemCount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return Math.floor(n);
}

function parseChannel(raw: unknown): "relay" | "home" | null {
  if (raw === "relay" || raw === "home") return raw;
  return null;
}

export async function POST(request: Request) {
  const { user, error: userError } = await resolveRequestUser(request);
  if (userError || !user) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  const env = getSendcloudEnv();
  if (!env?.checkoutConfigurationId) {
    return NextResponse.json(
      { error: "Sendcloud Dynamic Checkout non configuré." },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const itemCount = parseItemCount(o.item_count);
  const channel = parseChannel(o.delivery_channel);
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
  if (channel !== "relay" && channel !== "home") {
    return NextResponse.json({ error: "delivery_channel requis (relay | home)." }, { status: 400 });
  }

  if (channel === "home") {
    const homeQuotes = await fetchCheckoutHomeSendcloudPricing(env, {
      itemCount,
      memberPostalCode: postalCode,
      memberCountry: country,
      orderValueEur: Number.isFinite(orderValueEur) ? Math.max(0, orderValueEur) : 0,
    });

    if (!homeQuotes.ok) {
      const relayReturn = await fetchCheckoutRelaySendcloudPricing(env, {
        itemCount,
        memberPostalCode: postalCode,
        memberCountry: country,
        orderValueEur: Number.isFinite(orderValueEur) ? Math.max(0, orderValueEur) : 0,
      });
      return NextResponse.json(
        {
          error: homeQuotes.error,
          home_pricing: {
            method_options: [],
            default_option_code: null,
            return_ht_cents: relayReturn.ok ? relayReturn.pricing.returnHtCents : null,
            return_ttc_cents: relayReturn.ok ? relayReturn.pricing.returnTtcCents : null,
          },
          ...(shouldAttachCheckoutDebugToApiResponse() && homeQuotes.debug
            ? { _debug: homeQuotes.debug }
            : {}),
        },
        { status: 502 },
      );
    }

    const hp = homeQuotes.pricing;
    const options = hp.methodOptions.map((m) => ({
      id: m.deliveryMethodId,
      method_key: m.methodKey,
      title: m.title,
      option_code: m.optionCode,
      carrier_code: m.carrierCode,
      carrier_name: m.carrierName,
      carrier_logo_url: m.carrierLogoUrl,
      delivery_eta_label: m.deliveryEtaLabel,
      outbound_ht_cents: m.outboundHtCents,
      outbound_ttc_cents: m.outboundTtcCents,
      return_ht_cents: m.returnHtCents,
      return_ttc_cents: m.returnTtcCents,
      bundled_round_trip_ht_cents: m.bundledRoundTripHtCents,
      bundled_round_trip_ttc_cents: m.bundledRoundTripTtcCents,
    }));

    return NextResponse.json({
      pricing_source: "sendcloud",
      delivery_channel: channel,
      weight_grams: homeQuotes.weightGrams,
      weight_tier_label: `${(SEGNA_PARCEL_WEIGHT_GRAMS / 1000).toFixed(2).replace(".", ",")} kg`,
      home_pricing: {
        method_options: options,
        default_option_code: hp.defaultOptionCode,
        return_ht_cents: hp.returnHtCents,
        return_ttc_cents: hp.returnTtcCents,
      },
      default_option_code: hp.defaultOptionCode,
      return_ht_cents: hp.returnHtCents,
      return_ttc_cents: hp.returnTtcCents,
      options,
      ...(shouldAttachCheckoutDebugToApiResponse() && homeQuotes.debug
        ? { _debug: homeQuotes.debug }
        : {}),
    });
  }

  const quotes = await fetchCheckoutRelaySendcloudPricing(env, {
    itemCount,
    memberPostalCode: postalCode,
    memberCountry: country,
    orderValueEur: Number.isFinite(orderValueEur) ? Math.max(0, orderValueEur) : 0,
  });

  if (!quotes.ok) {
    return NextResponse.json({ error: quotes.error }, { status: 502 });
  }

  const p = quotes.pricing;

  return NextResponse.json({
    pricing_source: "sendcloud",
    delivery_channel: channel,
    weight_grams: quotes.weightGrams,
    weight_tier_label: `${(SEGNA_PARCEL_WEIGHT_GRAMS / 1000).toFixed(2).replace(".", ",")} kg`,
    relay_pricing: {
      delivery_method_id: p.deliveryMethodId,
      option_code: p.optionCode,
      title: p.title,
      delivery_eta_label: p.deliveryEtaLabel,
      outbound_ht_cents: p.outboundHtCents,
      outbound_ttc_cents: p.outboundTtcCents,
      return_ht_cents: p.returnHtCents,
      return_ttc_cents: p.returnTtcCents,
      bundled_round_trip_ht_cents: p.bundledRoundTripHtCents,
      bundled_round_trip_ttc_cents: p.bundledRoundTripTtcCents,
      carrier_options: p.carrierOptions.map((c) => ({
        carrier_code: c.carrierCode,
        carrier_name: c.carrierName,
        option_code: c.optionCode,
        carrier_logo_url: c.carrierLogoUrl,
      })),
    },
    default_option_code: p.optionCode,
    return_ttc_cents: p.returnTtcCents,
    options: [
      {
        id: p.deliveryMethodId,
        title: p.title,
        option_code: p.optionCode,
        delivery_eta_label: p.deliveryEtaLabel,
        outbound_ht_cents: p.outboundHtCents,
        outbound_ttc_cents: p.outboundTtcCents,
        return_ht_cents: p.returnHtCents,
        return_ttc_cents: p.returnTtcCents,
        bundled_round_trip_ht_cents: p.bundledRoundTripHtCents,
        bundled_round_trip_ttc_cents: p.bundledRoundTripTtcCents,
      },
    ],
  });
}
