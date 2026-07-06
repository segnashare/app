import type { CheckoutReturnRelayMeta } from "@/lib/cart/checkout-return-relay-meta";
import { getSegnaReturnDeliveryRelayCodesFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { getSegnaLogisticsHubFromEnv } from "@/lib/sendcloud/logistics-hub";
import { parseSendcloudRelayPointRef, relayPointCodeMatchKey, relayPointCodesMatch } from "@/lib/sendcloud/relay-point-ref";
import { resolveDefaultCheckoutReturnRelayHub } from "@/lib/sendcloud/resolve-checkout-return-relay-hub";
import {
  resolveSendcloudServicePointId,
  searchSendcloudServicePoints,
  type ResolvedSendcloudServicePoint,
} from "@/lib/sendcloud/service-points";

function uniqueFrenchPostcodes(...values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const pc = String(raw ?? "").replace(/\D/g, "").slice(0, 5);
    if (pc.length !== 5 || seen.has(pc)) continue;
    seen.add(pc);
    out.push(pc);
  }
  return out;
}

function minimalResolvedFromId(params: {
  id: number;
  relayCode: string;
  postalCode: string;
  label?: string | null;
  carrier?: string;
}): ResolvedSendcloudServicePoint {
  return {
    id: params.id,
    displayCode: params.relayCode,
    carrier: params.carrier ?? "mondial_relay",
    postNumber: null,
    postalCode: params.postalCode.replace(/\D/g, "").slice(0, 5),
    city: "",
    street: "",
    label: params.label?.trim() || params.relayCode,
  };
}

/**
 * Résout le point relais hub retour pour provision Sendcloud (checkout ou hub Segna par défaut).
 */
export async function resolveReturnHubSendcloudServicePoint(
  env: SendcloudEnv,
  params: { returnRelayMeta: CheckoutReturnRelayMeta },
): Promise<ResolvedSendcloudServicePoint | { error: string }> {
  const hubFallback = await resolveDefaultCheckoutReturnRelayHub();

  const relayCode =
    params.returnRelayMeta.returnRelayPointId?.trim() ||
    (hubFallback.ok ? hubFallback.selection.code : "") ||
    getSegnaReturnDeliveryRelayCodesFromEnv()[0]?.trim() ||
    "";
  if (!relayCode) return { error: "no_return_hub" };

  const relayLabel =
    params.returnRelayMeta.returnRelayLabel?.trim() ||
    (hubFallback.ok ? hubFallback.selection.label : null);

  const parsedRef = parseSendcloudRelayPointRef(relayCode);
  if (parsedRef?.servicePointId != null && parsedRef.servicePointId > 0) {
    const pc =
      params.returnRelayMeta.returnRelaySearchPostalCode ||
      (hubFallback.ok ? hubFallback.selection.postalCode || hubFallback.hubPostal : "") ||
      getSegnaLogisticsHubFromEnv()?.postalCode ||
      "";
    return minimalResolvedFromId({
      id: parsedRef.servicePointId,
      relayCode,
      postalCode: pc,
      label: relayLabel,
      carrier: parsedRef.carrier ?? undefined,
    });
  }

  if (hubFallback.ok) {
    const hubServicePointId = hubFallback.selection.sendcloudServicePointId;
    if (hubServicePointId != null && hubServicePointId > 0) {
      const pc =
        params.returnRelayMeta.returnRelaySearchPostalCode ||
        hubFallback.selection.postalCode ||
        hubFallback.hubPostal ||
        getSegnaLogisticsHubFromEnv()?.postalCode ||
        "";
      return minimalResolvedFromId({
        id: hubServicePointId,
        relayCode,
        postalCode: pc,
        label: relayLabel,
        carrier: hubFallback.selection.sendcloudCarrier,
      });
    }
  }

  const hub = getSegnaLogisticsHubFromEnv();
  const postalCandidates = uniqueFrenchPostcodes(
    params.returnRelayMeta.returnRelaySearchPostalCode,
    hubFallback.ok ? hubFallback.selection.postalCode : "",
    hubFallback.ok ? hubFallback.hubPostal : "",
    hub?.postalCode,
  );

  for (const postalCode of postalCandidates) {
    const resolved = await resolveSendcloudServicePointId(env, {
      relayCode,
      country: hub?.country ?? "FR",
      postalCode,
    });
    if (!("error" in resolved)) return resolved;
  }

  if (hub) {
    const { points } = await searchSendcloudServicePoints(env, {
      country: hub.country,
      postalCode: hub.postalCode,
      carrier: "mondial_relay",
    });
    const matchKey = relayPointCodeMatchKey(relayCode);
    const hit =
      points.find((p) => relayPointCodesMatch(p.displayCode, relayCode)) ||
      points.find((p) => relayPointCodesMatch(p.code, relayCode)) ||
      points.find((p) => relayPointCodeMatchKey(p.code) === matchKey) ||
      points.find((p) => relayPointCodeMatchKey(p.displayCode) === matchKey) ||
      points.find((p) => String(p.id) === matchKey);
    if (hit) {
      return {
        id: hit.id,
        displayCode: hit.displayCode,
        carrier: hit.carrier,
        postNumber: null,
        postalCode: hit.postalCode,
        city: hit.city,
        street: hit.street,
        label: hit.label,
      };
    }
  }

  return { error: `Point relais hub retour « ${relayCode} » introuvable via Sendcloud.` };
}
