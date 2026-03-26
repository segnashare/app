import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NON_CANCELLABLE_STAGES = new Set(["in_transit", "member_verification_pending", "member_issue_reported", "settled"]);

export async function POST(request: Request) {
  const ct = request.headers.get("content-type") ?? "";
  let itemId = "";
  if (ct.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
    }
    const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    itemId = typeof o.item_id === "string" ? o.item_id.trim() : "";
  } else {
    const form = await request.formData();
    itemId = String(form.get("item_id") ?? new URL(request.url).searchParams.get("item_id") ?? "").trim();
  }
  if (!itemId) {
    return NextResponse.json({ ok: false as const, error: "item_id requis" }, { status: 400 });
  }

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

  const { data: item } = await admin
    .from("items")
    .select("id,status,owner_user_id,deleted_at")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.owner_user_id !== user.id || item.deleted_at != null) {
    return NextResponse.json({ ok: false as const, error: "Accès refusé" }, { status: 403 });
  }

  const { data: outtake } = await admin
    .from("item_outtake")
    .select("stage,metadata")
    .eq("item_id", itemId)
    .maybeSingle();
  if (!outtake) {
    return NextResponse.json({ ok: false as const, error: "Aucun retour enregistré" }, { status: 400 });
  }

  const stage = String(outtake.stage ?? "none");
  if (stage === "none") {
    return NextResponse.json({ ok: false as const, error: "Retour déjà annulé" }, { status: 400 });
  }
  if (NON_CANCELLABLE_STAGES.has(stage)) {
    return NextResponse.json({ ok: false as const, error: "Annulation impossible: retour déjà expédié ou traité." }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const prevMeta =
    outtake.metadata && typeof outtake.metadata === "object" && !Array.isArray(outtake.metadata)
      ? (outtake.metadata as Record<string, unknown>)
      : {};
  const nextMeta = {
    ...prevMeta,
    return_cancelled_at: nowIso,
    return_cancelled_by: "member",
  };

  const { error: outErr } = await admin
    .from("item_outtake")
    .update({
      stage: "none",
      deleted_at: nowIso,
      metadata: nextMeta as unknown as never,
      updated_at: nowIso,
    } as never)
    .eq("item_id", itemId);
  if (outErr) {
    return NextResponse.json({ ok: false as const, error: outErr.message }, { status: 500 });
  }

  if (String(item.status ?? "") === "retired") {
    const { error: itemErr } = await admin.from("items").update({ status: "available", updated_at: nowIso }).eq("id", itemId);
    if (itemErr) {
      return NextResponse.json({ ok: false as const, error: itemErr.message }, { status: 500 });
    }
  }

  const payload = { ok: true as const, item_id: itemId, stage: "none", item_status: "available" };
  if (ct.includes("application/json")) return NextResponse.json(payload);
  return NextResponse.redirect(new URL(`/items/${encodeURIComponent(itemId)}/retour`, request.url));
}
