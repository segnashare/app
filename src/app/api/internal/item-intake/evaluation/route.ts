import { NextResponse } from "next/server";

import { parseLooseFiniteNumber } from "@/lib/items/intake-metadata";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type EvaluationSummary = {
  suggested_range?: {
    low?: number;
    median?: number;
    high?: number;
  };
  segna_offer?: number;
  positioning?: string;
  rationale?: string;
  example_items?: Record<string, EvaluationExampleItem[]>;
  comparison_items?: EvaluationExampleItem[];
};

type EvaluationExampleItem = {
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

function asFiniteNumberLoose(value: unknown): number | null {
  const n = parseLooseFiniteNumber(value);
  return n != null ? n : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = asFiniteNumberLoose(c);
    if (n != null) return n;
  }
  return null;
}

function sanitizeExampleItem(value: unknown): EvaluationExampleItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const sortIndex = firstNumber(raw.sort_index);
  const price = firstNumber(raw.price);
  const favouriteCount = firstNumber(raw.favouriteCount);
  const photoCount = firstNumber(raw.photo_count);
  const title = asNonEmptyString(raw.title);
  const url = asNonEmptyString(raw.url);
  const previewImage = asNonEmptyString(raw.preview_image);
  const currency = asNonEmptyString(raw.currency);
  const brand = asNonEmptyString(raw.brand);
  const size = asNonEmptyString(raw.size);
  const condition = asNonEmptyString(raw.condition);
  const colour = asNonEmptyString(raw.colour);
  const country = asNonEmptyString(raw.country);

  const item: EvaluationExampleItem = {
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
    ...(typeof raw.isSold === "boolean" ? { isSold: raw.isSold } : {}),
    ...(country ? { country } : {}),
    ...(previewImage ? { preview_image: previewImage } : {}),
    ...(photoCount != null ? { photo_count: photoCount } : {}),
  };

  return title || url || previewImage || price != null || item.id != null ? item : null;
}

function sanitizeExampleList(value: unknown): EvaluationExampleItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map(sanitizeExampleItem).filter((item): item is EvaluationExampleItem => item != null);
  return list.length > 0
    ? [...list].sort((a, b) => (a.sort_index ?? Number.MAX_SAFE_INTEGER) - (b.sort_index ?? Number.MAX_SAFE_INTEGER))
    : undefined;
}

function sanitizeExampleGroups(value: unknown): Record<string, EvaluationExampleItem[]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, EvaluationExampleItem[]> = {};
  for (const [key, rawList] of Object.entries(value as Record<string, unknown>)) {
    const list = sanitizeExampleList(rawList);
    if (list?.length) out[key] = list;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeEvaluationSummary(value: unknown): EvaluationSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const suggested = raw.suggested_range;
  const suggestedRec =
    suggested && typeof suggested === "object" && !Array.isArray(suggested)
      ? (suggested as Record<string, unknown>)
      : null;
  const marketRef = raw.market_reference_range;
  const marketRefRec =
    marketRef && typeof marketRef === "object" && !Array.isArray(marketRef)
      ? (marketRef as Record<string, unknown>)
      : null;

  const low = firstNumber(
    suggestedRec?.low,
    marketRefRec?.low,
    raw.low,
    raw.fourchette_basse,
    raw.range_low,
  );
  const median = firstNumber(
    suggestedRec?.median,
    marketRefRec?.median,
    raw.median,
    raw.mediane,
    raw.median_price,
  );
  const high = firstNumber(
    suggestedRec?.high,
    marketRefRec?.high,
    raw.high,
    raw.fourchette_haute,
    raw.range_high,
  );
  const segnaOffer = firstNumber(
    raw.segna_offer,
    raw.valorisation_segna,
    raw.valorisationSegna,
    raw.segna_valuation,
    raw.offre_segna,
    raw.valorisation,
  );
  const positioning = asNonEmptyString(raw.positioning);
  const rationale =
    asNonEmptyString(raw.rationale) ??
    asNonEmptyString(raw.member_explanation) ??
    asNonEmptyString(raw.explanation);
  const exampleItems = sanitizeExampleGroups(raw.example_items);
  const comparisonItems = sanitizeExampleList(raw.comparison_items);

  const hasSuggestedRange = low != null || median != null || high != null;
  const hasCore =
    hasSuggestedRange ||
    segnaOffer != null ||
    positioning != null ||
    rationale != null ||
    exampleItems != null ||
    comparisonItems != null;

  if (!hasCore) return null;

  return {
    suggested_range: hasSuggestedRange
      ? {
          ...(low != null ? { low } : {}),
          ...(median != null ? { median } : {}),
          ...(high != null ? { high } : {}),
        }
      : undefined,
    ...(segnaOffer != null ? { segna_offer: segnaOffer } : {}),
    ...(positioning ? { positioning } : {}),
    ...(rationale ? { rationale } : {}),
    ...(exampleItems ? { example_items: exampleItems } : {}),
    ...(comparisonItems ? { comparison_items: comparisonItems } : {}),
  };
}

/**
 * Endpoint serveur-à-serveur (n8n -> app) pour enregistrer la synthèse IA dans `item_intake.metadata`.
 * Auth: `Authorization: Bearer ${SEGNA_INTERNAL_ITEM_INTAKE_EVALUATION_SECRET}`.
 */
export async function POST(request: Request) {
  const expected = process.env.SEGNA_INTERNAL_ITEM_INTAKE_EVALUATION_SECRET?.trim() ?? "";
  if (!expected) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const bodyCandidate = Array.isArray(parsedBody) ? parsedBody[0] : parsedBody;
  if (!bodyCandidate || typeof bodyCandidate !== "object" || Array.isArray(bodyCandidate)) {
    return NextResponse.json({ ok: false as const, error: "invalid_payload" }, { status: 400 });
  }
  const body = bodyCandidate as Record<string, unknown>;

  const itemId = asNonEmptyString(body.item_id);
  if (!itemId) {
    return NextResponse.json({ ok: false as const, error: "missing_item_id" }, { status: 400 });
  }

  const candidateSummary =
    body.summary ??
    body.evaluation ??
    body.ai_evaluation ??
    body.ai_evaluation_summary ??
    body;

  const summary = sanitizeEvaluationSummary(candidateSummary);
  if (!summary) {
    return NextResponse.json({ ok: false as const, error: "invalid_summary_payload" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: intake, error: selectError } = await admin
    .from("item_intake")
    .select("metadata")
    .eq("item_id", itemId)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ ok: false as const, error: "intake_lookup_failed", detail: selectError.message }, { status: 500 });
  }
  if (!intake) {
    return NextResponse.json({ ok: false as const, error: "item_intake_not_found" }, { status: 404 });
  }

  const currentMetadata =
    intake.metadata && typeof intake.metadata === "object" && !Array.isArray(intake.metadata)
      ? (intake.metadata as Record<string, unknown>)
      : {};

  const nextMetadata = {
    ...currentMetadata,
    ai_evaluation_summary: summary,
    ai_evaluation_summary_updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await admin
    .from("item_intake")
    .update({ metadata: nextMetadata })
    .eq("item_id", itemId);

  if (updateError) {
    return NextResponse.json({ ok: false as const, error: "intake_update_failed", detail: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true as const, item_id: itemId, metadata_key: "ai_evaluation_summary" });
}
