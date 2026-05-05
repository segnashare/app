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

  let low = firstNumber(
    suggestedRec?.low,
    marketRefRec?.low,
    raw.low,
    raw.fourchette_basse,
    raw.range_low,
  );
  let median = firstNumber(
    suggestedRec?.median,
    marketRefRec?.median,
    raw.median,
    raw.mediane,
    raw.median_price,
  );
  let high = firstNumber(
    suggestedRec?.high,
    marketRefRec?.high,
    raw.high,
    raw.fourchette_haute,
    raw.range_high,
  );
  let segnaOffer = firstNumber(
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

  const hasSuggestedRange = low != null || median != null || high != null;
  const hasCore =
    hasSuggestedRange ||
    segnaOffer != null ||
    positioning != null ||
    rationale != null;

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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

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

  const admin = createSupabaseAdminClient() as any;
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
