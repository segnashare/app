import { NextResponse } from "next/server";

import { patchItemIntakeMondialRelayMetadata } from "@/lib/items/item-intake-mr-patch";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const message = typeof o.message === "string" ? o.message.trim().slice(0, 800) : "";

  const valid = itemIds.filter((id) => UUID_RE.test(id));
  if (valid.length < 1 || valid.length > 5) {
    return NextResponse.json({ ok: false as const, error: "Entre 1 et 5 pièces requises" }, { status: 400 });
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

  const { data: rows } = await admin.from("items").select("id,owner_user_id,deleted_at").in("id", valid);
  const owned = (rows ?? []) as { id: string; owner_user_id: string; deleted_at: string | null }[];
  if (owned.length !== valid.length || owned.some((r) => r.owner_user_id !== user.id || r.deleted_at != null)) {
    return NextResponse.json({ ok: false as const, error: "Accès refusé" }, { status: 403 });
  }

  const iso = new Date().toISOString();
  const note = message ? `Aide membre: ${message}` : "Aide membre: demande sans message";

  for (const id of valid) {
    const patchRes = await patchItemIntakeMondialRelayMetadata(admin, id, {
      mr_member_help_requested_at: iso,
      mr_member_incident_note: note.slice(0, 2000),
    });
    if (!patchRes.ok) {
      return NextResponse.json({ ok: false as const, error: patchRes.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true as const });
}
