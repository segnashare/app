import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AllowedAction = "confirm" | "help";

function parseAction(value: unknown): AllowedAction | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "confirm") return "confirm";
  if (raw === "help") return "help";
  return null;
}

export async function POST(request: Request) {
  const ct = request.headers.get("content-type") ?? "";
  let itemId = "";
  let action: AllowedAction | null = null;

  if (ct.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
    }
    const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    itemId = typeof o.item_id === "string" ? o.item_id.trim() : "";
    action = parseAction(o.action);
  } else {
    const form = await request.formData();
    itemId = String(form.get("item_id") ?? "").trim();
    action = parseAction(form.get("action"));
  }

  if (!itemId) return NextResponse.json({ ok: false as const, error: "item_id requis" }, { status: 400 });
  if (!action) return NextResponse.json({ ok: false as const, error: "action invalide" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false as const, error: "Authentification requise" }, { status: 401 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Service indisponible" }, { status: 503 });
  }

  const { data: item } = await admin.from("items").select("id,owner_user_id,deleted_at").eq("id", itemId).maybeSingle();
  if (!item || item.owner_user_id !== user.id || item.deleted_at != null) {
    return NextResponse.json({ ok: false as const, error: "Accès refusé" }, { status: 403 });
  }

  const { data: outtake } = await admin.from("item_outtake").select("stage,metadata").eq("item_id", itemId).maybeSingle();
  if (!outtake) {
    return NextResponse.json({ ok: false as const, error: "Aucun retour enregistré" }, { status: 400 });
  }
  const currentStage = String(outtake.stage ?? "none");
  if (currentStage !== "member_verification_pending" && currentStage !== "member_issue_reported") {
    return NextResponse.json({ ok: false as const, error: "Action indisponible à cette étape" }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const prevMeta =
    outtake.metadata && typeof outtake.metadata === "object" && !Array.isArray(outtake.metadata)
      ? (outtake.metadata as Record<string, unknown>)
      : {};

  const nextStage = action === "confirm" ? "settled" : "member_issue_reported";
  const nextMeta: Record<string, unknown> = {
    ...prevMeta,
    member_verification_updated_at: nowIso,
    member_verification_action: action,
  };
  if (action === "confirm") {
    nextMeta.member_recovery_confirmed_at = nowIso;
  } else {
    nextMeta.member_issue_reported_at = nowIso;
  }

  const { error } = await admin
    .from("item_outtake")
    .update({
      stage: nextStage,
      metadata: nextMeta as unknown as never,
      updated_at: nowIso,
    } as never)
    .eq("item_id", itemId);
  if (error) {
    return NextResponse.json({ ok: false as const, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true as const, item_id: itemId, stage: nextStage });
}
