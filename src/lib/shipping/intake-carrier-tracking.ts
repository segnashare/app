/**
 * URLs de suivi transporteur pour retours intake (portail Sendcloud).
 * Ne pas confondre avec `label_url` (API Sendcloud /documents/label).
 */

export function isSendcloudLabelOrInternalUrl(url: string | null | undefined): boolean {
  const u = String(url ?? "")
    .trim()
    .toLowerCase();
  if (!u.startsWith("http")) return false;
  return (
    u.includes("panel.sendcloud") ||
    u.includes("sendcloud.sc/api") ||
    u.includes("api.sendcloud") ||
    u.includes("/documents/label") ||
    u.includes("/parcels/") && u.includes("/label")
  );
}

/** Suivi public Chronopost (numéros retour portail, ex. XT…). */
export function buildChronopostTrackingUrl(trackingNumber: string): string {
  const num = trackingNumber.trim();
  return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${encodeURIComponent(num)}&langue=fr`;
}

export function buildMondialRelayTrackingUrl(trackingNumber: string): string {
  return `https://www.mondialrelay.com/suivi-de-colis/?code=${encodeURIComponent(trackingNumber.trim())}`;
}

export function buildCarrierTrackingUrlFromNumber(trackingNumber: string | null | undefined): string | null {
  const num = String(trackingNumber ?? "").trim();
  if (!num) return null;
  if (num.toUpperCase().startsWith("XT")) {
    return buildChronopostTrackingUrl(num);
  }
  return buildMondialRelayTrackingUrl(num);
}

export function resolveIntakeMemberTrackingHref(
  trackingNumber: string | null | undefined,
  trackingUrl: string | null | undefined,
): { trackingNumber: string | null; trackingHref: string | null } {
  const num = typeof trackingNumber === "string" ? trackingNumber.trim() : "";
  const rawUrl = typeof trackingUrl === "string" ? trackingUrl.trim() : "";
  const url = rawUrl && !isSendcloudLabelOrInternalUrl(rawUrl) ? rawUrl : "";

  if (url.startsWith("http")) {
    return { trackingNumber: num || null, trackingHref: url };
  }
  if (num) {
    const built = buildCarrierTrackingUrlFromNumber(num);
    return { trackingNumber: num, trackingHref: built };
  }
  return { trackingNumber: null, trackingHref: null };
}
