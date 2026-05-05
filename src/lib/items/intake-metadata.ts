/** Clés optionnelles renseignées côté back office dans `item_intake.metadata`. */
export const INTAKE_META_REFUSAL_MESSAGE = "refusal_member_message";
export const INTAKE_META_COMPLEMENT_MESSAGE = "complement_member_message";
/** ISO / timestamptz texte Postgres, posé au passage en `listing_stage = evaluation`. */
export const INTAKE_META_EVALUATION_STARTED_AT = "evaluation_started_at";
/** Synthèse IA alimentée par n8n pour affichage sur la page evaluation. */
export const INTAKE_META_AI_EVALUATION_SUMMARY = "ai_evaluation_summary";

export type IntakeAiEvaluationSummary = {
  suggested_range?: {
    low?: number;
    median?: number;
    high?: number;
  };
  /** Points Segna (legacy nom stocké / attendu par l’API). */
  segna_offer?: number;
  positioning?: string;
  rationale?: string;
};

export function readIntakeMetaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Parse un nombre depuis un littéral JSON ou une chaîne (€, espaces, virgule décimale FR). */
export function parseLooseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  const normalized = s.replace(/\s/g, "").replace(",", ".");
  const direct = Number(normalized.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(direct)) return direct;
  const match = normalized.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function firstDefinedNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    const n = parseLooseFiniteNumber(c);
    if (n != null) return n;
  }
  return undefined;
}

function extractNumbersFromRationale(text: string): {
  segna_offer?: number;
  median?: number;
  low?: number;
  high?: number;
} {
  const out: { segna_offer?: number; median?: number; low?: number; high?: number } = {};

  const valor =
    text.match(/valorisation\s+Segna[^0-9]{0,24}(\d+(?:[.,]\d+)?)/i) ??
    text.match(/valorisation[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*(?:€|EUR|eur)/i);
  const v = valor?.[1] != null ? parseLooseFiniteNumber(valor[1]) : undefined;
  if (v != null) out.segna_offer = v;

  const med = text.match(/m[ée]diane[^0-9]{0,24}(\d+(?:[.,]\d+)?)/i);
  const m = med?.[1] != null ? parseLooseFiniteNumber(med[1]) : undefined;
  if (m != null) out.median = m;

  const range =
    text.match(/(\d+(?:[.,]\d+)?)\s*[–—\-]\s*(\d+(?:[.,]\d+)?)\s*(?:€|EUR)/i) ??
    text.match(/entre\s+(\d+(?:[.,]\d+)?)\s*(?:et|à)\s*(\d+(?:[.,]\d+)?)/i);
  if (range?.[1] != null && range?.[2] != null) {
    const a = parseLooseFiniteNumber(range[1]);
    const b = parseLooseFiniteNumber(range[2]);
    if (a != null && b != null) {
      out.low = Math.min(a, b);
      out.high = Math.max(a, b);
    }
  }

  return out;
}

function mergeSuggestedRange(
  base: { low?: number; median?: number; high?: number },
  patch: { low?: number; median?: number; high?: number },
): { low?: number; median?: number; high?: number } {
  return {
    ...(base.low != null ? { low: base.low } : patch.low != null ? { low: patch.low } : {}),
    ...(base.median != null ? { median: base.median } : patch.median != null ? { median: patch.median } : {}),
    ...(base.high != null ? { high: base.high } : patch.high != null ? { high: patch.high } : {}),
  };
}

export function readIntakeAiEvaluationSummary(metadata: unknown): IntakeAiEvaluationSummary | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>)[INTAKE_META_AI_EVALUATION_SUMMARY];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const suggested = value.suggested_range;
  const suggestedObj = suggested && typeof suggested === "object" ? (suggested as Record<string, unknown>) : null;
  const marketRef = value.market_reference_range;
  const marketRefObj =
    marketRef && typeof marketRef === "object" && !Array.isArray(marketRef)
      ? (marketRef as Record<string, unknown>)
      : null;

  const low = firstDefinedNumber(
    suggestedObj?.low,
    marketRefObj?.low,
    value.low,
    value.fourchette_basse,
    value.range_low,
    (value as Record<string, unknown>)["fourchette basse"],
  );
  const median = firstDefinedNumber(
    suggestedObj?.median,
    marketRefObj?.median,
    value.median,
    value.mediane,
    value.median_price,
  );
  const high = firstDefinedNumber(
    suggestedObj?.high,
    marketRefObj?.high,
    value.high,
    value.fourchette_haute,
    value.range_high,
    (value as Record<string, unknown>)["fourchette haute"],
  );
  const segnaOffer = firstDefinedNumber(
    value.segna_offer,
    value.valorisation_segna,
    value.valorisationSegna,
    value.segna_valuation,
    value.offre_segna,
    value.valorisation,
  );
  const positioning = typeof value.positioning === "string" && value.positioning.trim() ? value.positioning.trim() : undefined;
  const rationale =
    (typeof value.rationale === "string" && value.rationale.trim() ? value.rationale.trim() : undefined) ??
    (typeof value.member_explanation === "string" && value.member_explanation.trim()
      ? value.member_explanation.trim()
      : undefined) ??
    (typeof value.explanation === "string" && value.explanation.trim() ? value.explanation.trim() : undefined);

  let mergedLow = low;
  let mergedMedian = median;
  let mergedHigh = high;
  let mergedSegna = segnaOffer;

  if (rationale && (mergedSegna == null || mergedMedian == null || mergedLow == null || mergedHigh == null)) {
    const extracted = extractNumbersFromRationale(rationale);
    if (mergedSegna == null && extracted.segna_offer != null) mergedSegna = extracted.segna_offer;
    if (mergedMedian == null && extracted.median != null) mergedMedian = extracted.median;
    if ((mergedLow == null || mergedHigh == null) && extracted.low != null && extracted.high != null) {
      mergedLow = mergedLow ?? extracted.low;
      mergedHigh = mergedHigh ?? extracted.high;
    }
  }

  const rangeMerged = mergeSuggestedRange(
    { low: mergedLow, median: mergedMedian, high: mergedHigh },
    {},
  );
  const hasSuggested = rangeMerged.low != null || rangeMerged.median != null || rangeMerged.high != null;
  const hasAny =
    hasSuggested || mergedSegna != null || positioning != null || rationale != null;
  if (!hasAny) return null;

  return {
    suggested_range: hasSuggested
      ? {
          ...(rangeMerged.low != null ? { low: rangeMerged.low } : {}),
          ...(rangeMerged.median != null ? { median: rangeMerged.median } : {}),
          ...(rangeMerged.high != null ? { high: rangeMerged.high } : {}),
        }
      : undefined,
    ...(mergedSegna != null ? { segna_offer: mergedSegna } : {}),
    ...(positioning ? { positioning } : {}),
    ...(rationale ? { rationale } : {}),
  };
}

/** Commentaire saisi côté BO lors du refus logistique (`metadata.verification`). */
export function readLogisticsRefusalNote(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const verification = (metadata as Record<string, unknown>).verification;
  if (!verification || typeof verification !== "object") return null;
  const v = verification as Record<string, unknown>;
  const refusal = v.refusal_comment;
  const last = v.last_logistics_decision_note;
  if (typeof refusal === "string" && refusal.trim()) return refusal.trim();
  if (typeof last === "string" && last.trim()) return last.trim();
  return null;
}

/** Retourne un timestamp ms pour le décompte 24h, ou null si non exploitable. */
export function resolveEvaluationCountdownStartMs(metadata: unknown, intakeUpdatedAtIso: string | null | undefined): number | null {
  const fromMeta = readIntakeMetaString(metadata, INTAKE_META_EVALUATION_STARTED_AT);
  if (fromMeta) {
    const p = Date.parse(fromMeta);
    if (!Number.isNaN(p)) return p;
  }
  if (intakeUpdatedAtIso && intakeUpdatedAtIso.trim()) {
    const p = Date.parse(intakeUpdatedAtIso.trim());
    if (!Number.isNaN(p)) return p;
  }
  return null;
}
