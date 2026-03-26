import { createHash } from "node:crypto";

import { parseStringPromise, processors } from "xml2js";

import type { MondialRelaySoapEnv } from "@/lib/mondial-relay/config";

export type RelaySearchHit = {
  code: string;
  label: string;
  postalCode: string;
  city: string;
  /** Pays du point relais (SOAP `Pays`) — pour `LIV_Rel_Pays` / plan de tri */
  country: string;
  numRaw: string;
};

/** Hash Security (module RelayPoint / usages courants e-commerce). */
export function mondialRelayWsi3SearchSecurity(input: {
  enseigne: string;
  pays: string;
  cp: string;
  poids: string;
  action: string;
  privateKey: string;
}): string {
  const raw =
    input.enseigne +
    input.pays +
    input.cp +
    input.poids +
    input.action +
    input.privateKey;
  return createHash("md5").update(raw, "utf8").digest("hex").toUpperCase();
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Code expédition Connect : `FR-000123` à partir du `Num` SOAP si besoin. */
export function connectRelayLocationCode(country: string, numRaw: string): string {
  const num = String(numRaw ?? "").trim();
  if (!num) return "";
  if (/^[A-Za-z]{2}-/.test(num)) return num.toUpperCase();
  const digits = num.replace(/\D/g, "");
  if (!digits) return num;
  const cc = (country || "FR").trim().toUpperCase() || "FR";
  return `${cc}-${digits.padStart(6, "0")}`;
}

function buildSearchEnvelope(
  env: MondialRelaySoapEnv,
  params: {
    pays: string;
    cp: string;
    poidsGrams: number;
    action: string;
  },
): string {
  const cp = params.cp.trim();
  const pays = params.pays.trim().toUpperCase() || "FR";
  const poidsStr = String(Math.max(1, Math.floor(params.poidsGrams)));
  const action = params.action.trim() || env.defaultAction;
  const security = mondialRelayWsi3SearchSecurity({
    enseigne: env.enseigne,
    pays,
    cp,
    poids: poidsStr,
    action,
    privateKey: env.privateKey,
  });

  const E = xmlEscape;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <WSI3_PointRelais_Recherche xmlns="http://www.mondialrelay.fr/webservice/">
      <Enseigne>${E(env.enseigne)}</Enseigne>
      <Pays>${E(pays)}</Pays>
      <NumPointRelais></NumPointRelais>
      <Ville></Ville>
      <CP>${E(cp)}</CP>
      <Latitude></Latitude>
      <Longitude></Longitude>
      <Taille></Taille>
      <Poids>${E(poidsStr)}</Poids>
      <Action>${E(action)}</Action>
      <DelaiEnvoi></DelaiEnvoi>
      <RayonRecherche></RayonRecherche>
      <TypeActivite></TypeActivite>
      <NACE></NACE>
      <Security>${E(security)}</Security>
    </WSI3_PointRelais_Recherche>
  </soap:Body>
</soap:Envelope>`;
}

function findFirstDeep(node: unknown, key: string): unknown {
  if (node == null) return undefined;
  if (Array.isArray(node)) {
    for (const x of node) {
      const f = findFirstDeep(x, key);
      if (f !== undefined) return f;
    }
    return undefined;
  }
  if (typeof node !== "object") return undefined;
  const o = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
  for (const v of Object.values(o)) {
    const f = findFirstDeep(v, key);
    if (f !== undefined) return f;
  }
  return undefined;
}

function normalizeDetailsList(raw: unknown): Record<string, unknown>[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  if (typeof raw === "object") return [raw as Record<string, unknown>];
  return [];
}

function strField(row: Record<string, unknown>, k: string): string {
  const v = row[k];
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function labelFromDetail(row: Record<string, unknown>): string {
  const name = strField(row, "LgAdr1");
  const street = strField(row, "LgAdr3");
  const cp = strField(row, "CP");
  const ville = strField(row, "Ville");
  const mid = [street, [cp, ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const parts = [name, mid].filter(Boolean);
  return parts.join(" — ") || strField(row, "Num");
}

/**
 * Interroge `WSI3_PointRelais_Recherche` (SOAP 1.1).
 */
export async function searchRelayPointsSoap(
  env: MondialRelaySoapEnv,
  input: { country: string; postalCode: string; weightGrams: number; action: string },
): Promise<{ points: RelaySearchHit[]; rawStat?: string }> {
  const body = buildSearchEnvelope(env, {
    pays: input.country,
    cp: input.postalCode,
    poidsGrams: input.weightGrams,
    action: input.action,
  });

  const res = await fetch(env.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"http://www.mondialrelay.fr/webservice/WSI3_PointRelais_Recherche"',
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Mondial Relay SOAP HTTP ${res.status}`);
  }

  const parsed: unknown = await parseStringPromise(text, {
    explicitArray: false,
    tagNameProcessors: [processors.stripPrefix],
  });

  const fault = findFirstDeep(parsed, "Fault") as Record<string, unknown> | undefined;
  if (fault) {
    const reason =
      strField(fault as Record<string, unknown>, "faultstring") ||
      strField(fault as Record<string, unknown>, "Reason") ||
      "SOAP Fault";
    throw new Error(reason);
  }

  const wsiResult = findFirstDeep(parsed, "WSI3_PointRelais_RechercheResult") as
    | Record<string, unknown>
    | undefined;

  if (!wsiResult || typeof wsiResult !== "object") {
    throw new Error("Réponse MR SOAP invalide (résultat absent)");
  }

  const stat = strField(wsiResult, "STAT");
  if (stat && stat !== "0") {
    return { points: [], rawStat: stat };
  }

  const pointsRelais = wsiResult.PointsRelais as Record<string, unknown> | undefined;
  if (!pointsRelais || typeof pointsRelais !== "object") {
    return { points: [], rawStat: stat || undefined };
  }

  const details = normalizeDetailsList(pointsRelais.PointRelais_Details);
  const country = input.country.trim().toUpperCase() || "FR";

  const points: RelaySearchHit[] = [];
  for (const row of details) {
    const statPoint = strField(row, "STAT");
    if (statPoint && statPoint !== "0") continue;
    const numRaw = strField(row, "Num");
    if (!numRaw) continue;
    const code = connectRelayLocationCode(country, numRaw);
    const ptCountry = strField(row, "Pays").toUpperCase() || country;
    points.push({
      code,
      numRaw,
      label: labelFromDetail(row),
      postalCode: strField(row, "CP"),
      city: strField(row, "Ville"),
      country: ptCountry,
    });
  }

  return { points, rawStat: stat || undefined };
}
