/** Clés optionnelles renseignées côté back office dans `item_intake.metadata`. */
export const INTAKE_META_REFUSAL_MESSAGE = "refusal_member_message";
export const INTAKE_META_COMPLEMENT_MESSAGE = "complement_member_message";
/** ISO / timestamptz texte Postgres, posé au passage en `listing_stage = evaluation`. */
export const INTAKE_META_EVALUATION_STARTED_AT = "evaluation_started_at";
/** Synthèse IA alimentée par n8n pour affichage sur la page evaluation. */
export const INTAKE_META_AI_EVALUATION_SUMMARY = "ai_evaluation_summary";
/** Révision prix IA : conserve l'analyse initiale, remplace seulement prix + explication membre. */
export const INTAKE_META_AI_PRICE_REVALUATION = "ai_price_revaluation";

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
  example_items?: IntakeEvaluationExampleGroups;
  comparison_items?: IntakeEvaluationExampleItem[];
};

export type IntakeAiPriceRevaluation = {
  segna_offer?: number;
  rationale?: string;
  positioning?: string;
};

export type IntakeEvaluationExampleItem = {
  sort_index?: number;
  id?: string | number;
  title?: string;
  url?: string;
  price?: number;
  currency?: string;
  brand?: string;
  size?: string;
  condition?: string;
  colour?: string;
  favouriteCount?: number;
  isSold?: boolean;
  country?: string;
  preview_image?: string;
  photo_count?: number;
};

export type IntakeEvaluationExampleGroups = Record<string, IntakeEvaluationExampleItem[]>;

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

function readExampleString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readExampleBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readEvaluationExampleItem(value: unknown): IntakeEvaluationExampleItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const sortIndex = firstDefinedNumber(raw.sort_index);
  const price = firstDefinedNumber(raw.price);
  const favouriteCount = firstDefinedNumber(raw.favouriteCount);
  const photoCount = firstDefinedNumber(raw.photo_count);
  const title = readExampleString(raw.title);
  const url = readExampleString(raw.url);
  const currency = readExampleString(raw.currency);
  const brand = readExampleString(raw.brand);
  const size = readExampleString(raw.size);
  const condition = readExampleString(raw.condition);
  const colour = readExampleString(raw.colour);
  const isSold = readExampleBoolean(raw.isSold);
  const country = readExampleString(raw.country);
  const previewImage = readExampleString(raw.preview_image);

  const item: IntakeEvaluationExampleItem = {
    ...(sortIndex != null ? { sort_index: sortIndex } : {}),
    ...(typeof raw.id === "number" || typeof raw.id === "string" ? { id: raw.id } : {}),
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(price != null ? { price } : {}),
    ...(currency ? { currency } : {}),
    ...(brand ? { brand } : {}),
    ...(size ? { size } : {}),
    ...(condition ? { condition } : {}),
    ...(colour ? { colour } : {}),
    ...(favouriteCount != null ? { favouriteCount } : {}),
    ...(isSold != null ? { isSold } : {}),
    ...(country ? { country } : {}),
    ...(previewImage ? { preview_image: previewImage } : {}),
    ...(photoCount != null ? { photo_count: photoCount } : {}),
  };

  const hasRenderableValue = Boolean(item.title || item.url || item.preview_image || item.price != null || item.id != null);
  return hasRenderableValue ? item : null;
}

function readEvaluationExampleList(value: unknown): IntakeEvaluationExampleItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map(readEvaluationExampleItem).filter((item): item is IntakeEvaluationExampleItem => item != null);
  return list.length > 0
    ? [...list].sort((a, b) => (a.sort_index ?? Number.MAX_SAFE_INTEGER) - (b.sort_index ?? Number.MAX_SAFE_INTEGER))
    : undefined;
}

function readEvaluationExampleGroups(value: unknown): IntakeEvaluationExampleGroups | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: IntakeEvaluationExampleGroups = {};
  for (const [key, rawList] of Object.entries(value as Record<string, unknown>)) {
    const list = readEvaluationExampleList(rawList);
    if (list?.length) out[key] = list;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  const exampleItems = readEvaluationExampleGroups(value.example_items);
  const comparisonItems = readEvaluationExampleList(value.comparison_items);

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
    hasSuggested || mergedSegna != null || positioning != null || rationale != null || exampleItems != null || comparisonItems != null;
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
    ...(exampleItems ? { example_items: exampleItems } : {}),
    ...(comparisonItems ? { comparison_items: comparisonItems } : {}),
  };
}

export function readIntakeAiPriceRevaluation(metadata: unknown): IntakeAiPriceRevaluation | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>)[INTAKE_META_AI_PRICE_REVALUATION];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const summary = value.summary && typeof value.summary === "object" && !Array.isArray(value.summary)
    ? (value.summary as Record<string, unknown>)
    : null;
  const segnaOffer = firstDefinedNumber(
    value.segna_offer,
    value.adjusted_segna_price,
    value.segna_price_points,
    summary?.segna_offer,
    summary?.adjusted_segna_price,
  );
  const rationale =
    (typeof value.member_explanation === "string" && value.member_explanation.trim()
      ? value.member_explanation.trim()
      : undefined) ??
    (typeof summary?.member_explanation === "string" && summary.member_explanation.trim()
      ? summary.member_explanation.trim()
      : undefined) ??
    (typeof value.rationale === "string" && value.rationale.trim() ? value.rationale.trim() : undefined) ??
    (typeof summary?.rationale === "string" && summary.rationale.trim() ? summary.rationale.trim() : undefined) ??
    (typeof value.explanation === "string" && value.explanation.trim() ? value.explanation.trim() : undefined) ??
    (typeof summary?.explanation === "string" && summary.explanation.trim() ? summary.explanation.trim() : undefined) ??
    (typeof value.adjustment_reason === "string" && value.adjustment_reason.trim()
      ? value.adjustment_reason.trim()
      : undefined);
  const positioning =
    (typeof value.positioning === "string" && value.positioning.trim()
      ? value.positioning.trim()
      : undefined) ??
    (typeof summary?.positioning === "string" && summary.positioning.trim()
      ? summary.positioning.trim()
      : undefined) ??
    (typeof value.positionning === "string" && value.positionning.trim()
      ? value.positionning.trim()
      : undefined) ??
    (typeof summary?.positionning === "string" && summary.positionning.trim()
      ? summary.positionning.trim()
      : undefined);

  if (segnaOffer == null && !rationale && !positioning) return null;
  return {
    ...(segnaOffer != null ? { segna_offer: segnaOffer } : {}),
    ...(rationale ? { rationale } : {}),
    ...(positioning ? { positioning } : {}),
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
