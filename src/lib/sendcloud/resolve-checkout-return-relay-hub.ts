import type { CheckoutRelaySelection } from "@/lib/cart/checkout-delivery-storage";
import { getSegnaReturnDeliveryRelayHubEntriesFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import {
  getReturnHubRelayDisplayCodesFromEnv,
  getSegnaLogisticsHubFromEnv,
  getSendcloudReturnHubServicePointIdsFromEnv,
} from "@/lib/sendcloud/logistics-hub";
import { searchSendcloudServicePoints } from "@/lib/sendcloud/service-points";

export type CheckoutReturnHubRelayPoint = {
  code: string;
  label: string;
  postalCode: string;
  city?: string;
  sendcloudServicePointId?: number;
  sendcloudCode: string;
  sendcloudCarrier?: string;
  is_hub_return: boolean;
};

function hubPointToCheckoutSelection(p: CheckoutReturnHubRelayPoint): CheckoutRelaySelection {
  return {
    code: p.code,
    label: p.label,
    postalCode: p.postalCode,
    city: p.city,
    sendcloudServicePointId: p.sendcloudServicePointId,
    sendcloudCarrier: (p.sendcloudCarrier ?? "mondial_relay").trim() || "mondial_relay",
    isHubReturn: true,
  };
}

function pickDefaultHubPoint(points: CheckoutReturnHubRelayPoint[]): CheckoutReturnHubRelayPoint | null {
  if (points.length === 0) return null;

  const envEntries = getSegnaReturnDeliveryRelayHubEntriesFromEnv();
  if (envEntries.length > 0) {
    for (const entry of envEntries) {
      const code = entry.code.trim().toUpperCase();
      const found = points.find((p) => p.code.trim().toUpperCase() === code);
      if (found) {
        return { ...found, label: entry.label.trim() || found.label };
      }
    }
  }

  const whitelistIds = getSendcloudReturnHubServicePointIdsFromEnv();
  if (whitelistIds.length > 0) {
    for (const id of whitelistIds) {
      const found = points.find((p) => p.sendcloudServicePointId === id);
      if (found) return found;
    }
  }

  return points[0]!;
}

/** Liste les points relais hub autorisés (config Segna, secteur logistique). */
export async function listCheckoutReturnHubRelays(params?: {
  carrier?: string;
}): Promise<
  | { ok: true; points: CheckoutReturnHubRelayPoint[]; hubPostal: string }
  | { ok: false; error: string; status: number }
> {
  const env = getSendcloudEnv();
  if (!env) {
    return { ok: false, error: "Sendcloud non configuré.", status: 501 };
  }

  const hub = getSegnaLogisticsHubFromEnv();
  if (!hub) {
    return {
      ok: false,
      error: "Hub logistique non configuré (MONDR_SEGNA_RECIP_POSTCODE, etc.).",
      status: 503,
    };
  }

  const carrier = (params?.carrier ?? "mondial_relay").trim();
  const whitelistIds = getSendcloudReturnHubServicePointIdsFromEnv();
  const hubDisplayCodes = new Set(
    getReturnHubRelayDisplayCodesFromEnv().map((c) => c.trim().toUpperCase()),
  );

  const { points: batch, error } = await searchSendcloudServicePoints(env, {
    country: hub.country,
    postalCode: hub.postalCode,
    carrier,
  });

  if (error && batch.length === 0) {
    return { ok: false, error, status: 502 };
  }

  let points: CheckoutReturnHubRelayPoint[] = batch.map((p) => ({
    code: p.displayCode,
    label: p.label,
    postalCode: p.postalCode,
    city: p.city || undefined,
    sendcloudServicePointId: p.id,
    sendcloudCode: p.code,
    sendcloudCarrier: p.carrier,
    is_hub_return: true,
  }));

  if (whitelistIds.length > 0) {
    const allowed = new Set(whitelistIds);
    points = points.filter(
      (p) => p.sendcloudServicePointId != null && allowed.has(p.sendcloudServicePointId),
    );
  }

  if (hubDisplayCodes.size > 0) {
    points = points.filter((p) => hubDisplayCodes.has(p.code.trim().toUpperCase()));
  }

  if (points.length === 0) {
    const envEntries = getSegnaReturnDeliveryRelayHubEntriesFromEnv();
    for (const entry of envEntries) {
      points.push({
        code: entry.code,
        label: entry.label,
        postalCode: hub.postalCode,
        sendcloudCode: entry.code,
        is_hub_return: true,
      });
    }
  }

  if (points.length === 0) {
    return {
      ok: false,
      error: "Aucun point relais hub retour configuré.",
      status: 503,
    };
  }

  return { ok: true, points, hubPostal: hub.postalCode };
}

/**
 * Point relais retour imposé par Segna (premier hub selon config) — jamais choisi par le membre.
 */
export async function resolveDefaultCheckoutReturnRelayHub(params?: {
  carrier?: string;
}): Promise<
  | { ok: true; selection: CheckoutRelaySelection; hubPostal: string }
  | { ok: false; error: string; status: number }
> {
  const listed = await listCheckoutReturnHubRelays({ carrier: params?.carrier });
  if (!listed.ok) return listed;

  const picked = pickDefaultHubPoint(listed.points);
  if (!picked) {
    return { ok: false, error: "Impossible de déterminer le point relais retour.", status: 503 };
  }

  return {
    ok: true,
    selection: hubPointToCheckoutSelection(picked),
    hubPostal: listed.hubPostal,
  };
}
