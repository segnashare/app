import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type IntakeRow = {
  item_id?: string;
  metadata?: unknown;
  listing_stage?: string | null;
};

function stripAiSummary(metadata: unknown): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  delete base.ai_evaluation_summary;
  delete base.ai_evaluation_summary_updated_at;
  return base;
}

async function ensureOwner(itemId: string, userId: string) {
  const admin = createSupabaseAdminClient() as any;
  const { data, error } = await admin
    .from("items")
    .select("id")
    .eq("id", itemId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 403, error: "forbidden" };
  return { ok: true as const };
}

export async function POST(request: Request) {
  let body: { itemId?: string; restart?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const itemId = String(body.itemId ?? "").trim();
  const restart = Boolean(body.restart);
  if (!itemId) {
    return NextResponse.json({ ok: false as const, error: "missing_item_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  const ownership = await ensureOwner(itemId, user.id);
  if (!ownership.ok) {
    return NextResponse.json({ ok: false as const, error: ownership.error }, { status: ownership.status });
  }

  const admin = createSupabaseAdminClient() as any;
  const { data: existing, error: existingError } = await admin
    .from("item_intake")
    .select("item_id,metadata,listing_stage")
    .eq("item_id", itemId)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ ok: false as const, error: existingError.message }, { status: 500 });
  }

  if (!existing?.item_id) {
    const { error: insertError } = await admin.from("item_intake").insert({
      item_id: itemId,
      listing_stage: "evaluation",
      metadata: {},
    });
    if (insertError) {
      return NextResponse.json({ ok: false as const, error: insertError.message }, { status: 409 });
    }
    return NextResponse.json({ ok: true as const, mode: "insert" });
  }

  if (restart) {
    const metadata = stripAiSummary((existing as IntakeRow).metadata);
    const { error: toDraftError } = await admin
      .from("item_intake")
      .update({ listing_stage: "draft", metadata })
      .eq("item_id", itemId);
    if (toDraftError) {
      return NextResponse.json(
        { ok: false as const, error: toDraftError.message, stage: "to_draft", code: toDraftError.code },
        { status: 409 },
      );
    }
  }

  const { error: toEvalError } = await admin
    .from("item_intake")
    .update({ listing_stage: "evaluation" })
    .eq("item_id", itemId);
  if (toEvalError) {
    return NextResponse.json(
      { ok: false as const, error: toEvalError.message, stage: "to_evaluation", code: toEvalError.code },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true as const, mode: restart ? "restart" : "set_evaluation" });
}
