import { NextResponse } from "next/server";

import {
  INTAKE_META_AI_EVALUATION_SUMMARY,
  parseLooseFiniteNumber,
} from "@/lib/items/intake-metadata";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveRoundedPoints(value: unknown): number | null {
  const n = parseLooseFiniteNumber(value);
  if (n == null || n <= 0) return null;
  return Math.round(n);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export async function POST(request: Request) {
  const expected = (
    process.env.SEGNA_INTERNAL_ITEM_INTAKE_PRICE_REVALUATION_SECRET ??
    process.env.SEGNA_INTERNAL_ITEM_INTAKE_EVALUATION_SECRET ??
    ""
  ).trim();
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
  const body = asObject(bodyCandidate);
  if (!body) {
    return NextResponse.json({ ok: false as const, error: "invalid_payload" }, { status: 400 });
  }
  const summary = asObject(body.summary);
  /** n8n envoie souvent `positioning` au niveau racine ; tolère le typo `positionning`. */
  const reevaluationPositioning =
    asNonEmptyString(body.positioning) ??
    asNonEmptyString(body.positionning) ??
    asNonEmptyString(summary?.positioning) ??
    asNonEmptyString(summary?.positionning);

  const itemId = asNonEmptyString(body.item_id);
  const adjustedPrice = asPositiveRoundedPoints(
    body.adjusted_segna_price ??
      body.segna_price_points ??
      body.price_points ??
      summary?.segna_offer ??
      summary?.adjusted_segna_price,
  );
  if (!itemId || adjustedPrice == null) {
    return NextResponse.json(
      { ok: false as const, error: "missing_item_id_or_adjusted_price" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const [{ data: itemRow, error: itemLookupError }, { data: intakeRow, error: intakeLookupError }] =
    await Promise.all([
      admin.from("items").select("price_points").eq("id", itemId).maybeSingle(),
      admin.from("item_intake").select("metadata").eq("item_id", itemId).maybeSingle(),
    ]);

  if (itemLookupError) {
    return NextResponse.json({ ok: false as const, error: "item_lookup_failed", detail: itemLookupError.message }, { status: 500 });
  }
  if (!itemRow) {
    return NextResponse.json({ ok: false as const, error: "item_not_found" }, { status: 404 });
  }
  if (intakeLookupError) {
    return NextResponse.json({ ok: false as const, error: "intake_lookup_failed", detail: intakeLookupError.message }, { status: 500 });
  }

  const previousPrice =
    asPositiveRoundedPoints(body.previous_segna_price) ??
    (itemRow.price_points != null ? Math.round(Number(itemRow.price_points)) : null);
  const now = new Date().toISOString();
  const priceRevaluation = {
    previous_segna_price: previousPrice,
    adjusted_segna_price: adjustedPrice,
    segna_offer: adjustedPrice,
    summary,
    adjustment_direction: asNonEmptyString(body.adjustment_direction),
    adjustment_reason:
      asNonEmptyString(body.adjustment_reason) ??
      asNonEmptyString(summary?.member_explanation) ??
      asNonEmptyString(summary?.rationale) ??
      asNonEmptyString(summary?.explanation),
    member_explanation:
      asNonEmptyString(body.member_explanation) ??
      asNonEmptyString(summary?.member_explanation) ??
      asNonEmptyString(summary?.rationale) ??
      asNonEmptyString(summary?.explanation),
    confidence: asNonEmptyString(body.confidence),
    backoffice_note: asNonEmptyString(body.backoffice_note),
    ...(reevaluationPositioning ? { positioning: reevaluationPositioning } : {}),
    updated_at: now,
  };

  const currentMetadata = asObject(intakeRow?.metadata) ?? {};
  const currentEvaluationSummary = asObject(currentMetadata[INTAKE_META_AI_EVALUATION_SUMMARY]);
  const nextEvaluationSummary =
    reevaluationPositioning != null
      ? {
          ...(currentEvaluationSummary ?? {}),
          positioning: reevaluationPositioning,
        }
      : currentEvaluationSummary;

  const nextMetadata = {
    ...currentMetadata,
    ai_price_revaluation: priceRevaluation,
    ai_price_revaluation_updated_at: now,
    ...(nextEvaluationSummary && Object.keys(nextEvaluationSummary).length > 0
      ? { [INTAKE_META_AI_EVALUATION_SUMMARY]: nextEvaluationSummary }
      : {}),
  };

  const [{ error: itemUpdateError }, { error: intakeUpdateError }] = await Promise.all([
    admin.from("items").update({ price_points: adjustedPrice }).eq("id", itemId),
    admin.from("item_intake").update({ metadata: nextMetadata }).eq("item_id", itemId),
  ]);

  if (itemUpdateError) {
    return NextResponse.json({ ok: false as const, error: "item_update_failed", detail: itemUpdateError.message }, { status: 500 });
  }
  if (intakeUpdateError) {
    return NextResponse.json({ ok: false as const, error: "intake_update_failed", detail: intakeUpdateError.message }, { status: 500 });
  }

  const { error: historyError } = await admin.from("item_price_history").insert({
    item_id: itemId,
    old_price_points: previousPrice,
    new_price_points: adjustedPrice,
    reason: "ai_price_revaluation",
    price_type: "exchange",
    source: "ai",
    metadata: priceRevaluation,
  });

  if (historyError) {
    console.warn("[price-revaluation] price history insert failed", historyError.message);
  }

  return NextResponse.json({
    ok: true as const,
    item_id: itemId,
    previous_segna_price: previousPrice,
    adjusted_segna_price: adjustedPrice,
    metadata_key: "ai_price_revaluation",
    ...(reevaluationPositioning
      ? { positioning_updated: true as const, positioning: reevaluationPositioning }
      : {}),
  });
}
