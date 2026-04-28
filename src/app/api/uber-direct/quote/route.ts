import { NextResponse } from "next/server";

import { buildFranceUberAddressJson } from "@/lib/uber-direct/addresses";
import { readUberDirectConfig } from "@/lib/uber-direct/config";
import { fetchUberDeliveryQuoteRaw } from "@/lib/uber-direct/deliveries-api";
import type { CheckoutDeliveryAddress } from "@/lib/cart/checkout-delivery-storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function extractUberQuoteErrorCode(detail: string): string | null {
  const t = detail.trim();
  if (!t.startsWith("{")) return null;
  try {
    const j = JSON.parse(t) as { code?: string };
    return typeof j.code === "string" && j.code.trim() ? j.code.trim() : null;
  } catch {
    return null;
  }
}

/** Message court membre (écran checkout), sans jargon serveur. */
function friendlyUberQuoteMessageFromDetail(detail: string): string {
  const t = detail.trim();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as {
        code?: string;
        message?: string;
        error?: string;
        error_description?: string;
        kind?: string;
        metadata?: { details?: string };
      };
      if (j.code === "address_undeliverable") {
        return "Cette adresse est un peu trop éloignée de notre lieu d’expédition. Rapproche la livraison ou choisis l’option standard.";
      }
      if (j.error === "invalid_client") {
        return "Service express momentanément indisponible. Réessaie plus tard ou contacte le support.";
      }
      if (typeof j.message === "string" && j.message.trim()) {
        return j.message.trim();
      }
      if (typeof j.error_description === "string" && j.error_description.trim()) {
        return j.error_description.trim();
      }
    } catch {
      /* JSON invalide : message générique ci-dessous */
    }
  }
  if (/invalid_client|client ID is invalid/i.test(t)) {
    return "Service express momentanément indisponible. Réessaie plus tard.";
  }
  return "Impossible d’afficher un tarif pour cette adresse. Vérifie l’adresse ou réessaie.";
}

function parseDeliveryAddress(raw: unknown): CheckoutDeliveryAddress | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.label !== "string" || o.label.trim() === "") return null;
  const lat = typeof o.lat === "number" ? o.lat : Number(o.lat);
  const lon = typeof o.lon === "number" ? o.lon : Number(o.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    label: o.label.trim(),
    lat,
    lon,
    city: typeof o.city === "string" ? o.city : null,
    relativeCity: typeof o.relativeCity === "string" ? o.relativeCity : null,
    timezone: typeof o.timezone === "string" ? o.timezone : "Europe/Paris",
  };
}

/**
 * Devis Uber Direct (`delivery_quotes`) pour l’adresse de livraison du checkout.
 * Authentifié — ne expose pas les secrets ; renvoie uniquement le JSON Uber.
 */
export async function POST(request: Request) {
  try {
    const config = readUberDirectConfig();
    if (!config) {
      return NextResponse.json(
        { ok: false, message: "Uber Direct n’est pas configuré sur ce serveur." },
        { status: 503 },
      );
    }

    const supabase = (await createSupabaseServerClient()) as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ ok: false, message: "Session invalide." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ ok: false, message: "Corps de requête invalide." }, { status: 400 });
    }

    const deliveryAddress = parseDeliveryAddress(body.deliveryAddress);
    if (!deliveryAddress) {
      return NextResponse.json({ ok: false, message: "Adresse de livraison incomplète." }, { status: 400 });
    }

    const dropoffAddressJson = buildFranceUberAddressJson(deliveryAddress.label, deliveryAddress.city ?? deliveryAddress.relativeCity);

    const quote = await fetchUberDeliveryQuoteRaw({
      config,
      dropoffAddressJson,
    });

    return NextResponse.json({ ok: true, quote });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "uber_quote_failed";
    const short = msg.startsWith("uber_quote_") ? msg.replace(/^uber_quote_\d+:\s*/i, "").slice(0, 500) : msg.slice(0, 500);
    console.error("[uber-direct/quote]", msg);
    const code = extractUberQuoteErrorCode(short);
    const body: Record<string, unknown> = {
      ok: false,
      message: friendlyUberQuoteMessageFromDetail(short),
      ...(code ? { code } : {}),
    };
    /** Détail technique (réponse Uber / stack) : jamais renvoyé en production. */
    if (process.env.NODE_ENV === "development") {
      body.detail = short;
    }
    return NextResponse.json(body, { status: 502 });
  }
}
