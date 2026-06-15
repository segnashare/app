import { NextResponse } from "next/server";

import { moveItemToOuttakeGroup } from "@/lib/items/member-outtake-groups";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const itemId = typeof o.item_id === "string" ? o.item_id.trim() : "";
  const targetTransferId =
    typeof o.target_transfer_id === "string" ? o.target_transfer_id.trim() || null : null;

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

  const moved = await moveItemToOuttakeGroup(admin, {
    userId: user.id,
    itemId,
    targetTransferId,
  });

  if (!moved.ok) {
    return NextResponse.json({ ok: false as const, error: moved.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true as const, groups: moved.groups });
}
