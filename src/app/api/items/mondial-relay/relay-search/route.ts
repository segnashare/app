import { NextResponse } from "next/server";

import { getMondialRelaySoapEnv } from "@/lib/mondial-relay/config";
import { mondialRelayDebugLog } from "@/lib/mondial-relay/mr-debug-log";
import { buildPlanTriRelayDiagnosticsWhenAllStat97 } from "@/lib/mondial-relay/plan-tri-relay-diagnostics";
import { filterRelayHitsByPlanTri } from "@/lib/mondial-relay/soap-plan-tri-pretri";
import { getSegnaRecipientFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import { searchRelayPointsSoap } from "@/lib/mondial-relay/soap-point-relais-search";
import {
  formatMissingEnvMessage,
  getShippingEnvDiagnostics,
} from "@/lib/shipping/server-env-diagnostics";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RELAY_ACTIONS = new Set(["24R", "24L", "LCC", "XOH"]);

function maskPostalForLog(cp: string): string {
  const t = cp.replace(/\s/g, "").trim();
  if (t.length <= 2) return "**";
  return `${t.slice(0, 2)}…${t.slice(-2)}`;
}

function planTriHost(soap: { planTriEndpoint: string }): string {
  try {
    return new URL(soap.planTriEndpoint).hostname;
  } catch {
    return "invalid_plan_tri_url";
  }
}

function optPositiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

type RelaySearchContext = {
  weight_g: number;
  action: string;
  parcel_count: number;
  collection_mode: "REL" | "CCC";
  dimensions_cm: { length: number; width: number; depth: number } | null;
  content_value_eur: number | null;
  insurance_level: string | null;
  wsi3_note: string;
};

/** Même logique que le backoffice ; réservé aux membres connectés (préparation expédition avancée). */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  const soap = getMondialRelaySoapEnv();
  if (!soap) {
    const diagnostics = getShippingEnvDiagnostics();
    const soapDiag = diagnostics.mondial_relay_soap;
    return NextResponse.json(
      {
        error: formatMissingEnvMessage("Recherche points relais (Mondial Relay SOAP)", soapDiag.missing),
        diagnostics,
      },
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
  const skipPlanTri = o.skip_plan_tri === true;
  const postalCode = typeof o.postal_code === "string" ? o.postal_code.trim() : "";
  const country =
    (typeof o.country === "string" ? o.country.trim().toUpperCase() : "") || "FR";
  const actionRaw = typeof o.action === "string" ? o.action.trim().toUpperCase() : "";
  const action = RELAY_ACTIONS.has(actionRaw) ? actionRaw : soap.defaultAction;

  const weightRaw = o.weight_g;
  const weightNum =
    typeof weightRaw === "number"
      ? weightRaw
      : typeof weightRaw === "string"
        ? parseInt(weightRaw, 10)
        : NaN;
  const weightG = Number.isFinite(weightNum) && weightNum > 0 ? Math.floor(weightNum) : 0;

  const pcRaw = o.parcel_count;
  const pcNum =
    typeof pcRaw === "number" ? pcRaw : typeof pcRaw === "string" ? parseInt(pcRaw, 10) : NaN;
  const parcelCount = Number.isFinite(pcNum) ? Math.min(9, Math.max(1, Math.floor(pcNum))) : 1;

  const collectionMode: "REL" | "CCC" = o.collection_mode === "CCC" ? "CCC" : "REL";

  const l = optPositiveInt(o.parcel_length_cm);
  const w = optPositiveInt(o.parcel_width_cm);
  const d = optPositiveInt(o.parcel_depth_cm);
  const dimensionsCm =
    l != null && w != null && d != null ? { length: l, width: w, depth: d } : null;

  const valRaw = o.content_value_eur;
  const valNum =
    typeof valRaw === "number" ? valRaw : typeof valRaw === "string" ? parseInt(valRaw, 10) : NaN;
  const contentValueEur =
    Number.isFinite(valNum) && valNum >= 0 ? Math.floor(valNum) : null;

  const insuranceRaw = o.insurance_level;
  const insuranceLevel =
    typeof insuranceRaw === "string" && insuranceRaw.trim() !== "" ? insuranceRaw.trim() : null;

  const wsi3Note =
    "API WSI3 : seuls poids + produit (Action) influencent les points ; le mode collecte, les dimensions, la valeur et l’assurance seront pris en compte à la création d’étiquette Connect.";

  if (!postalCode) {
    return NextResponse.json({ error: "postal_code requis" }, { status: 400 });
  }

  if (weightG < 1) {
    const ctx: RelaySearchContext = {
      weight_g: 0,
      action,
      parcel_count: parcelCount,
      collection_mode: collectionMode,
      dimensions_cm: dimensionsCm,
      content_value_eur: contentValueEur,
      insurance_level: insuranceLevel,
      wsi3_note: wsi3Note,
    };
    return NextResponse.json(
      {
        error: "weight_g requis (grammes), même valeur que la section Colis",
        search_context: ctx,
      },
      { status: 400 },
    );
  }

  const searchContext: RelaySearchContext = {
    weight_g: weightG,
    action,
    parcel_count: parcelCount,
    collection_mode: collectionMode,
    dimensions_cm: dimensionsCm,
    content_value_eur: contentValueEur,
    insurance_level: insuranceLevel,
    wsi3_note: wsi3Note,
  };

  try {
    mondialRelayDebugLog("relay-search:request", {
      country,
      postal_code: maskPostalForLog(postalCode),
      action,
      weight_g: weightG,
      skip_plan_tri: skipPlanTri,
      wsi3_endpoint_host: (() => {
        try {
          return new URL(soap.endpoint).hostname;
        } catch {
          return "invalid_wsi3_url";
        }
      })(),
    });

    const { points, rawStat } = await searchRelayPointsSoap(soap, {
      country,
      postalCode,
      weightGrams: weightG,
      action,
    });

    mondialRelayDebugLog("relay-search:wsi3_result", {
      points_count: points.length,
      mondial_relay_stat: rawStat ?? null,
    });

    if (rawStat && rawStat !== "0" && points.length === 0) {
      return NextResponse.json(
        {
          points: [],
          search_context: searchContext,
          mondial_relay_stat: rawStat,
          hint: `Mondial Relay a renvoyé STAT=${rawStat} (aucun point). Vérifier CP, poids, produit Action=${action} et identifiants API 1.`,
        },
        { status: 200 },
      );
    }

    let outPoints = points;
    let planTri: {
      applied: boolean;
      excluded_count: number;
      excluded_samples: { code: string; statut: string }[];
      excluded_stat_histogram?: Record<string, number>;
      skipped_reason?: string;
      destination_postcode?: string;
    } | null = null;

    const hub = getSegnaRecipientFromEnv();
    if (skipPlanTri) {
      planTri = {
        applied: false,
        excluded_count: 0,
        excluded_samples: [],
        skipped_reason: "skip_plan_tri=true : liste brute WSI3 (risque erreur plan de tri à l’étiquette).",
      };
    } else if (!hub) {
      planTri = {
        applied: false,
        excluded_count: 0,
        excluded_samples: [],
        skipped_reason:
          "Filtrage plan de tri désactivé : hub Segna incomplet. La liste provient uniquement de WSI3.",
      };
    } else {
      const { kept, meta } = await filterRelayHitsByPlanTri(soap, points, {
        modeLiv: action,
        destPostcode: hub.PostCode,
        destCountry: hub.CountryCode,
      });
      outPoints = kept;
      planTri = {
        applied: meta.applied,
        excluded_count: meta.excluded_count,
        excluded_samples: meta.excluded_samples,
        excluded_stat_histogram: meta.excluded_stat_histogram,
        destination_postcode: hub.PostCode,
      };
      if (points.length > 0 && kept.length === 0) {
        const planTriDiagnostics =
          buildPlanTriRelayDiagnosticsWhenAllStat97({
            soap,
            modeLiv: action,
            hubDestPostcode: hub.PostCode,
            hubDestCountry: hub.CountryCode,
            wsi3ReturnedHits: points.length > 0,
            excludedStatHistogram: meta.excluded_stat_histogram,
            excludedCount: meta.excluded_count,
          }) ?? undefined;

        console.warn("[mondial-relay:relay-search] plan_tri_excluded_all_relays", {
          search_country: country,
          search_postal_masked: maskPostalForLog(postalCode),
          action,
          weight_g: weightG,
          wsi3_points: points.length,
          mondial_relay_stat: rawStat ?? null,
          hub_country: hub.CountryCode,
          hub_postal_masked: maskPostalForLog(hub.PostCode),
          plan_tri_host: planTriHost(soap),
          wsi3_host: (() => {
            try {
              return new URL(soap.endpoint).hostname;
            } catch {
              return "invalid";
            }
          })(),
          excluded_stat_histogram: meta.excluded_stat_histogram ?? {},
          excluded_samples: meta.excluded_samples,
          plan_tri_diagnostics: planTriDiagnostics,
          doc: "Interpréter les codes Statut avec Mondial Relay ; vérifier hub MONDR_SEGNA_RECIP_*, MONDR_RELAY_SOAP_ACTION et MONDR_RELAY_SOAP_PLAN_TRI_URL. Logs détaillés : MONDR_MR_DEBUG_LOG=1.",
        });

        return NextResponse.json({
          points: [],
          search_context: searchContext,
          mondial_relay_stat: rawStat ?? null,
          plan_tri: planTri,
          ...(planTriDiagnostics ? { plan_tri_diagnostics: planTriDiagnostics } : {}),
          hint:
            "Aucun point ne passe le contrôle plan de tri pour le hub Segna et ce produit. Tu peux relancer avec skip_plan_tri=true pour voir la liste WSI3 brute (à tes risques).",
        });
      }
    }

    return NextResponse.json({
      points: outPoints,
      search_context: searchContext,
      mondial_relay_stat: rawStat ?? null,
      plan_tri: planTri,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    mondialRelayDebugLog("relay-search:error", { message: msg.slice(0, 400) });
    console.error("[mondial-relay:relay-search] exception", { message: msg.slice(0, 400) });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
