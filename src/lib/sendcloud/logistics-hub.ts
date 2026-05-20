import { getSegnaRecipientFromEnv, getSegnaReturnDeliveryRelayCodesFromEnv } from "@/lib/mondial-relay/segna-recipient-env";

export type SegnaLogisticsHub = {
  postalCode: string;
  country: string;
  city: string | null;
};

/** CP / pays du centre logistique Segna (retour relais → hub). */
export function getSegnaLogisticsHubFromEnv(): SegnaLogisticsHub | null {
  const hub = getSegnaRecipientFromEnv();
  if (!hub?.PostCode) return null;
  const postalCode = hub.PostCode.replace(/\D/g, "").slice(0, 5);
  if (postalCode.length < 5) return null;
  return {
    postalCode,
    country: (hub.CountryCode ?? "FR").trim().toUpperCase().slice(0, 2) || "FR",
    city: hub.City?.trim() || null,
  };
}

/**
 * IDs Sendcloud autorisés pour le dépôt retour membre (whitelist).
 * `SENDCLOUD_RETURN_HUB_SERVICE_POINT_IDS=123,456` ou codes MR `FR-…` via
 * `MONDR_SEGNA_RETURN_DELIVERY_RELAY_CODE` (résolus côté recherche).
 */
export function getSendcloudReturnHubServicePointIdsFromEnv(): number[] {
  const raw = process.env.SENDCLOUD_RETURN_HUB_SERVICE_POINT_IDS?.trim() ?? "";
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** Codes affichage PR hub (ex. `FR-123456`) — alignés Mondial Relay. */
export function getReturnHubRelayDisplayCodesFromEnv(): string[] {
  return getSegnaReturnDeliveryRelayCodesFromEnv();
}
