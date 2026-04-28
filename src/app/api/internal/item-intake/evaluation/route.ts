import { NextResponse } from "next/server";

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

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeEvaluationSummary(value: unknown): EvaluationSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const low = asFiniteNumber((raw.suggested_range as Record<string, unknown> | undefined)?.low);
  const median = asFiniteNumber((raw.suggested_range as Record<string, unknown> | undefined)?.median);
  const high = asFiniteNumber((raw.suggested_range as Record<string, unknown> | undefined)?.high);
  const segnaOffer = asFiniteNumber(raw.segna_offer);
  const positioning = asNonEmptyString(raw.positioning);
  const rationale = asNonEmptyString(raw.rationale);

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
