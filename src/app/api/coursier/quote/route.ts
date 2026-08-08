import { NextResponse } from "next/server";

import { parseFranceCoursierAddress } from "@/lib/coursier/addresses";
import { readCoursierConfig } from "@/lib/coursier/config";
import { isCoursierCheckoutEnabled } from "@/lib/coursier/coursier-checkout-enabled";
import {
  buildCoursierExpressQuoteFromGetpriceOffers,
  fetchCoursierGetPriceOffers,
} from "@/lib/coursier/getprice-api";
import { buildDefaultCoursierPackages } from "@/lib/coursier/packages";
import {
  buildCoursierQuoteDebugSummary,
  logCoursierQuoteDebug,
} from "@/lib/coursier/quote-debug";
import type { CheckoutDeliveryAddress } from "@/lib/cart/checkout-delivery-storage";
import {
  formatMissingEnvMessage,
  getShippingEnvDiagnostics,
} from "@/lib/shipping/server-env-diagnostics";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

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

function parseItemCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

function exposeCoursierQuoteBrowserDebug(): boolean {
  return process.env.NODE_ENV === "development" || process.env.SEGNA_DEBUG_COURSIER_QUOTE_BROWSER === "1";
}

/** Message court membre (écran checkout), sans jargon serveur. */
function friendlyCoursierQuoteMessageFromDetail(detail: string): string {
  const t = detail.trim();
  if (/coursier_getprice_error:/i.test(t)) {
    return t.replace(/^coursier_getprice_error:\s*/i, "").trim() || "Devis indisponible pour cette adresse.";
  }
  if (/empty|no_express|no_checkout_offers|no_direct_2h|invalid_price|unexpected_shape/i.test(t)) {
    return "Aucun créneau express disponible pour cette adresse.";
  }
  if (/401|403|unauthorized|forbidden/i.test(t)) {
    return "Service express momentanément indisponible. Réessaie plus tard.";
  }
  return "Impossible d’afficher un tarif pour cette adresse. Vérifie l’adresse ou réessaie.";
}

/**
 * Devis Coursier.fr (`getprice`) pour l’adresse de livraison du checkout.
 * Authentifié — ne expose pas les secrets ; renvoie le devis express normalisé.
 */
export async function POST(request: Request) {
  if (!isCoursierCheckoutEnabled()) {
    return NextResponse.json({ ok: false, message: "Livraison express Coursier.fr désactivée." }, { status: 404 });
  }

  let quoteDebug: ReturnType<typeof buildCoursierQuoteDebugSummary> | null = null;
  try {
    const config = readCoursierConfig();
    if (!config) {
      const diagnostics = getShippingEnvDiagnostics();
      const coursierDiag = diagnostics.coursier;
      return NextResponse.json(
        {
          ok: false,
          message: formatMissingEnvMessage("Coursier.fr", coursierDiag.missing),
          diagnostics,
        },
        { status: 503 },
      );
    }

    const { user, error: userError } = await resolveRequestUserClient(request);
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

    const toAddress = parseFranceCoursierAddress(
      deliveryAddress.label,
      deliveryAddress.city ?? deliveryAddress.relativeCity,
    );
    if (!toAddress.PostalCode || !toAddress.Address) {
      return NextResponse.json(
        { ok: false, message: "Adresse de livraison incomplète (rue ou code postal manquant)." },
        { status: 400 },
      );
    }

    const itemCount = parseItemCount(body.itemCount);
    const allOffers = await fetchCoursierGetPriceOffers({
      config,
      fromAddress: config.pickupAddress,
      toAddress,
      packages: buildDefaultCoursierPackages(itemCount),
    });
    const debug = buildCoursierQuoteDebugSummary(allOffers);
    quoteDebug = debug;
    if (process.env.NODE_ENV === "development") {
      logCoursierQuoteDebug("devis checkout", debug);
    }

    const quote = buildCoursierExpressQuoteFromGetpriceOffers(allOffers);

    const payload: Record<string, unknown> = { ok: true, quote };
    if (exposeCoursierQuoteBrowserDebug()) {
      payload.debug = debug;
    }
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "coursier_quote_failed";
    const short = msg.startsWith("coursier_getprice_")
      ? msg.replace(/^coursier_getprice_\d+:\s*/i, "").slice(0, 500)
      : msg.slice(0, 500);
    console.error("[coursier/quote]", msg);
    if (quoteDebug && process.env.NODE_ENV === "development") {
      logCoursierQuoteDebug("devis checkout — échec", quoteDebug);
    }
    const body: Record<string, unknown> = {
      ok: false,
      message: friendlyCoursierQuoteMessageFromDetail(short),
    };
    if (exposeCoursierQuoteBrowserDebug()) {
      body.detail = short;
      if (quoteDebug) body.debug = quoteDebug;
    }
    return NextResponse.json(body, { status: 502 });
  }
}
