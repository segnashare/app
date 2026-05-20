import type { MondialRelaySoapEnv } from "@/lib/mondial-relay/config";
import type { RelaySearchHit } from "@/lib/mondial-relay/soap-point-relais-search";
import { searchRelayPointsSoap } from "@/lib/mondial-relay/soap-point-relais-search";
import { filterRelayHitsByPlanTri, type PlanTriFilterMeta } from "@/lib/mondial-relay/soap-plan-tri-pretri";

function normalizePostalCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 5);
}

function mergeRelayHitsByCode(lists: RelaySearchHit[][]): RelaySearchHit[] {
  const seen = new Set<string>();
  const out: RelaySearchHit[] = [];
  for (const list of lists) {
    for (const hit of list) {
      const code = hit.code.trim();
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push(hit);
    }
  }
  return out;
}

export type CartOutboundRelaySearchResult = {
  points: RelaySearchHit[];
  search_postcodes: string[];
  wsi3_total_before_plan_tri: number;
  plan_tri: PlanTriFilterMeta & { destination_postcode?: string };
};

/**
 * Recherche relais pour livraison panier (hub Segna → point relais membre).
 * - WSI3 sur le CP membre **et** le CP hub (plus de candidats).
 * - Plan de tri : destination = hub (aligné Connect sandbox / expédition aller).
 * - Erreur technique PlanTri → relais exclu (fail-closed).
 */
export async function searchRelayPointsForCartOutbound(
  soap: MondialRelaySoapEnv,
  params: {
    memberPostalCode: string;
    country: string;
    weightGrams: number;
    action: string;
    hubPostCode: string;
    hubCountry: string;
  },
): Promise<CartOutboundRelaySearchResult> {
  const memberPc = normalizePostalCode(params.memberPostalCode);
  const hubPc = normalizePostalCode(params.hubPostCode);
  const searchPostcodes: string[] = [];
  if (memberPc.length === 5) searchPostcodes.push(memberPc);
  if (hubPc.length === 5 && !searchPostcodes.includes(hubPc)) searchPostcodes.push(hubPc);

  const wsi3Batches: RelaySearchHit[][] = [];
  for (const pc of searchPostcodes) {
    const { points } = await searchRelayPointsSoap(soap, {
      country: params.country,
      postalCode: pc,
      weightGrams: params.weightGrams,
      action: params.action,
    });
    wsi3Batches.push(points);
  }

  const merged = mergeRelayHitsByCode(wsi3Batches);

  const { kept, meta } = await filterRelayHitsByPlanTri(soap, merged, {
    modeLiv: params.action,
    destPostcode: hubPc || params.hubPostCode.trim(),
    destCountry: params.hubCountry,
    failClosedOnTechnicalError: true,
  });

  return {
    points: kept,
    search_postcodes: searchPostcodes,
    wsi3_total_before_plan_tri: merged.length,
    plan_tri: { ...meta, destination_postcode: hubPc || params.hubPostCode.trim() },
  };
}
