import { NextResponse } from "next/server";

import { cancelDueIntakeDummyShipments } from "@/lib/items/member-intake-return-portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Annule les expéditions aller factices dont le délai est écoulé. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawIds = o.item_ids;
  const itemIds = Array.isArray(rawIds)
    ? rawIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

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

  await cancelDueIntakeDummyShipments(admin, itemIds);
  return NextResponse.json({ ok: true as const });
}
