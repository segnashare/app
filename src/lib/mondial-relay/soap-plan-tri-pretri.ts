import { createHash } from "node:crypto";

import { parseStringPromise, processors } from "xml2js";

import type { MondialRelaySoapEnv } from "@/lib/mondial-relay/config";
import { mondialRelayDebugLog } from "@/lib/mondial-relay/mr-debug-log";
import type { RelaySearchHit } from "@/lib/mondial-relay/soap-point-relais-search";

/** Numéro relais attendu par MR sur LIV_Rel (souvent 6 chiffres, cf. regex modules historiques). */
export function mondialRelayLivRelSixDigits(numRaw: string, connectCode: string): string {
  const digits =
    String(numRaw ?? "")
      .replace(/\D/g, "")
      .trim() ||
    String(connectCode ?? "")
      .replace(/^([A-Z]{2})-/i, "")
      .replace(/\D/g, "")
      .trim();
  if (!digits) return "";
  if (digits.length >= 6) return digits.slice(-6);
  return digits.padStart(6, "0");
}

/**
 * Security ObtenirPreTri : concaténation des champs dans l’ordre du corps SOAP, + clé privée (cf. usages PrestaShop / doc MR).
 */
export function obtenirPreTriSecurity(input: {
  enseigne: string;
  modeLiv: string;
  destCp: string;
  destPays: string;
  livRelPays: string;
  livRel: string;
  privateKey: string;
}): string {
  const u = (s: string) => s.trim().toUpperCase();
  const raw =
    u(input.enseigne) +
    u(input.modeLiv) +
    u(input.destCp) +
    u(input.destPays) +
    u(input.livRelPays) +
    u(input.livRel) +
    input.privateKey.trim();
  return createHash("md5").update(raw, "utf8").digest("hex").toUpperCase();
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function strField(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

/** MR : Statut vide ou « 0 » = plan de tri résolu (aligné sur STAT 0 = OK côté autres WS MR). */
function isPlanTriStatutOk(statut: string): boolean {
  const s = statut.trim();
  if (!s) return true;
  return s === "0";
}

function buildObtenirPreTriEnvelope(
  env: MondialRelaySoapEnv,
  params: {
    modeLiv: string;
    destCp: string;
    destPays: string;
    livRelPays: string;
    livRel: string;
  },
): string {
  const modeLiv = params.modeLiv.trim().toUpperCase();
  const destCp = params.destCp.trim();
  const destPays = params.destPays.trim().toUpperCase();
  const livRelPays = params.livRelPays.trim().toUpperCase();
  const livRel = params.livRel.trim();

  const security = obtenirPreTriSecurity({
    enseigne: env.enseigne,
    modeLiv,
    destCp,
    destPays,
    livRelPays,
    livRel,
    privateKey: env.privateKey,
  });

  const E = xmlEscape;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ObtenirPreTri xmlns="http://www.mondialrelay.fr/webservice/">
      <Enseigne>${E(env.enseigne)}</Enseigne>
      <ModeLiv>${E(modeLiv)}</ModeLiv>
      <Dest_CP>${E(destCp)}</Dest_CP>
      <Dest_Pays>${E(destPays)}</Dest_Pays>
      <LIV_Rel_Pays>${E(livRelPays)}</LIV_Rel_Pays>
      <LIV_Rel>${E(livRel)}</LIV_Rel>
      <Security>${E(security)}</Security>
    </ObtenirPreTri>
  </soap:Body>
</soap:Envelope>`;
}

async function callObtenirPreTriOnce(
  env: MondialRelaySoapEnv,
  params: {
    modeLiv: string;
    destCp: string;
    destPays: string;
    livRelPays: string;
    livRel: string;
  },
): Promise<{ statut: string; ok: boolean }> {
  const body = buildObtenirPreTriEnvelope(env, params);
  const res = await fetch(env.planTriEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"http://www.mondialrelay.fr/webservice/ObtenirPreTri"',
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PlanTri HTTP ${res.status}`);
  }

  const parsed: unknown = await parseStringPromise(text, {
    explicitArray: false,
    tagNameProcessors: [processors.stripPrefix],
  });

  const fault = findFirstDeep(parsed, "Fault") as Record<string, unknown> | undefined;
  if (fault) {
    const reason =
      strField(fault, "faultstring") || strField(fault, "Reason") || "SOAP Fault (PlanTri)";
    throw new Error(reason);
  }

  const result = findFirstDeep(parsed, "ObtenirPreTriResult") as Record<string, unknown> | undefined;
  if (!result) {
    throw new Error("Réponse ObtenirPreTri sans résultat");
  }
  const statut = strField(result, "Statut");
  return { statut, ok: isPlanTriStatutOk(statut) };
}

export type PlanTriFilterMeta = {
  applied: boolean;
  excluded_count: number;
  excluded_samples: { code: string; statut: string }[];
  /** Comptage des codes statut MR pour les relais exclus (diagnostic sans lire les logs). */
  excluded_stat_histogram?: Record<string, number>;
  skipped_reason?: string;
};

const PRETI_CHUNK = 8;

async function mapInChunks<T, R>(items: T[], chunkSize: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const part = await Promise.all(chunk.map((t) => fn(t)));
    out.push(...part);
  }
  return out;
}

/**
 * Garde uniquement les relais pour lesquels MR retourne un plan de tri (ObtenirPreTri) pour la destination hub.
 */
export async function filterRelayHitsByPlanTri(
  env: MondialRelaySoapEnv,
  hits: RelaySearchHit[],
  input: {
    modeLiv: string;
    destPostcode: string;
    destCountry: string;
    /** Checkout panier : ne pas garder un relais si ObtenirPreTri échoue techniquement. */
    failClosedOnTechnicalError?: boolean;
  },
): Promise<{ kept: RelaySearchHit[]; meta: PlanTriFilterMeta }> {
  if (hits.length === 0) {
    return {
      kept: [],
      meta: { applied: false, excluded_count: 0, excluded_samples: [] },
    };
  }

  const destCp = input.destPostcode.trim();
  const destPays = input.destCountry.trim().toUpperCase() || "FR";
  const modeLiv = input.modeLiv.trim().toUpperCase();

  type Row =
    | { kind: "keep"; hit: RelaySearchHit }
    | { kind: "drop"; code: string; statut: string };

  const rows = await mapInChunks(hits, PRETI_CHUNK, async (hit): Promise<Row> => {
    const livRel = mondialRelayLivRelSixDigits(hit.numRaw, hit.code);
    const livRelPays = (hit.country || "FR").trim().toUpperCase();

    if (!livRel) {
      return { kind: "drop", code: hit.code, statut: "(sans numéro relais)" };
    }
    try {
      const { statut, ok } = await callObtenirPreTriOnce(env, {
        modeLiv,
        destCp,
        destPays,
        livRelPays,
        livRel,
      });
      if (ok) return { kind: "keep", hit };
      return { kind: "drop", code: hit.code, statut: statut || "?" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      mondialRelayDebugLog("plan-tri:obtenir_pretri_error", {
        relay_code: hit.code,
        liv_rel: livRel,
        liv_rel_pays: livRelPays,
        error: msg.slice(0, 240),
        fail_closed: Boolean(input.failClosedOnTechnicalError),
      });
      if (input.failClosedOnTechnicalError) {
        return { kind: "drop", code: hit.code, statut: `erreur technique: ${msg.slice(0, 80)}` };
      }
      return { kind: "keep", hit };
    }
  });

  const kept: RelaySearchHit[] = [];
  const excluded_samples: { code: string; statut: string }[] = [];
  const excluded_stat_histogram: Record<string, number> = {};
  let excluded_count = 0;

  for (const r of rows) {
    if (r.kind === "keep") {
      kept.push(r.hit);
    } else {
      excluded_count++;
      const st = r.statut || "?";
      excluded_stat_histogram[st] = (excluded_stat_histogram[st] ?? 0) + 1;
      if (excluded_samples.length < 8) {
        excluded_samples.push({ code: r.code, statut: r.statut });
      }
    }
  }

  mondialRelayDebugLog("plan-tri:summary", {
    wsi3_hits: hits.length,
    kept: kept.length,
    excluded: excluded_count,
    modeLiv,
    dest_pays: destPays,
    dest_cp_len: destCp.length,
    plan_tri_host: (() => {
      try {
        return new URL(env.planTriEndpoint).hostname;
      } catch {
        return "invalid_url";
      }
    })(),
    excluded_stat_histogram,
    excluded_samples,
  });

  return {
    kept,
    meta: {
      applied: true,
      excluded_count,
      excluded_samples,
      excluded_stat_histogram,
    },
  };
}
