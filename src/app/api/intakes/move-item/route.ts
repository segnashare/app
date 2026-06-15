import { NextResponse } from "next/server";

import { moveItemToIntakeGroup } from "@/lib/items/member-intake-groups";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const itemId = String(o.item_id ?? "").trim();
  const targetIntakeId =
    o.target_intake_id === null || o.target_intake_id === undefined
      ? null
      : String(o.target_intake_id).trim() || null;

  if (!itemId) {
    return NextResponse.json({ ok: false as const, error: "Pièce manquante." }, { status: 400 });
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

  const { data: owned } = await admin
    .from("items")
    .select("id")
    .eq("id", itemId)
    .eq("owner_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!owned?.id) {
    return NextResponse.json({ ok: false as const, error: "Pièce introuvable." }, { status: 404 });
  }

  const res = await moveItemToIntakeGroup(admin, {
    userId: user.id,
    itemId,
    targetIntakeId,
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false as const, error: res.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true as const, groups: res.groups });
}
