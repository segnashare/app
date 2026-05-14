import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const READY_STATUSES = new Set(["available"]);

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

  const itemStatus = String(item.status ?? "");
  const ready = READY_STATUSES.has(itemStatus);
  const nowIso = new Date().toISOString();

  const { data: prevOuttake } = await admin.from("item_outtake").select("metadata").eq("item_id", itemId).maybeSingle();
  const prevMeta =
    prevOuttake?.metadata && typeof prevOuttake.metadata === "object" && !Array.isArray(prevOuttake.metadata)
      ? (prevOuttake.metadata as Record<string, unknown>)
      : {};
  const nextMeta: Record<string, unknown> = {
    ...prevMeta,
    return_request_requested_at: nowIso,
    return_request_state: ready ? "ready" : "waiting_available",
  };

  if (ready && itemStatus !== "retired") {
    const { error } = await admin.from("items").update({ status: "retired", updated_at: nowIso }).eq("id", itemId);
    if (error) {
      return NextResponse.json({ ok: false as const, error: error.message }, { status: 500 });
    }
  }

  const { error: outErr } = await admin
    .from("item_outtake")
    .upsert(
      {
        item_id: itemId,
        stage: ready ? "return_open" : "none",
        metadata: nextMeta as unknown as never,
      },
      { onConflict: "item_id" },
    );
  if (outErr) {
    return NextResponse.json({ ok: false as const, error: outErr.message }, { status: 500 });
  }

  const payload = {
    ok: true as const,
    item_id: itemId,
    ready_for_shipping: ready,
    next: ready ? `/items/${encodeURIComponent(itemId)}/retour/expedition` : null,
  };
  if (ct.includes("application/json")) return NextResponse.json(payload);
  return NextResponse.redirect(
    new URL(
      payload.next ?? `/items/${encodeURIComponent(itemId)}/retour`,
      request.url,
    ),
  );
}
