/** Encodage `provider_point_id` / metadata checkout pour Sendcloud (+ carrier). */

export type ParsedSendcloudRelayRef = {
  servicePointId: number;
  carrier: string | null;
  postNumber: string | null;
};

const SC_REF_RE = /^sc:(\d+)(?:@([a-z0-9_]+))?(?:#([^#]+))?$/i;

export function encodeSendcloudRelayPointRef(input: {
  servicePointId: number;
  carrier?: string | null;
  postNumber?: string | null;
}): string {
  const id = Math.floor(input.servicePointId);
  if (!Number.isFinite(id) || id < 1) return "";
  const carrier = input.carrier?.trim().toLowerCase();
  const post = input.postNumber?.trim();
  let out = `sc:${id}`;
  if (carrier) out += `@${carrier}`;
  if (post) out += `#${post.slice(0, 40)}`;
  return out;
}

export function parseSendcloudRelayPointRef(raw: string): ParsedSendcloudRelayRef | null {
  const t = raw.trim();
  const m = SC_REF_RE.exec(t);
  if (!m) return null;
  const servicePointId = parseInt(m[1]!, 10);
  if (!Number.isFinite(servicePointId) || servicePointId < 1) return null;
  return {
    servicePointId,
    carrier: m[2]?.trim().toLowerCase() || null,
    postNumber: m[3]?.trim() || null,
  };
}

export function carrierDisplayName(carrier: string | null | undefined): string {
  const c = (carrier ?? "").trim().toLowerCase();
  if (c === "mondial_relay") return "Mondial Relay";
  if (c === "colissimo") return "Colissimo";
  if (c === "chronopost") return "Chronopost";
  if (c === "dhl") return "DHL";
  if (!c) return "Point relais";
  return c.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Affichage checkout : nom + adresse, sans préfixe transporteur. */
export function formatCheckoutRelayDisplayLabel(label: string): string {
  const t = label.trim();
  if (!t) return "Point relais";
  const stripped = t.replace(
    /^(mondial\s*relay|colissimo|chronopost|dhl|ups|dpd)\s*[—–\-]\s*/i,
    "",
  );
  return stripped.trim() || t;
}
