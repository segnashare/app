import { NextResponse } from "next/server";

import { runMemberSendcloudAutoGenerate } from "@/lib/items/member-sendcloud-auto-generate";
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
  const rawIds = o.item_ids;
  const itemIds = Array.isArray(rawIds)
    ? rawIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : typeof rawIds === "string"
      ? rawIds
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
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

  const force = o.force === true;
  const res = await runMemberSendcloudAutoGenerate(admin, { userId: user.id, itemIds, force });
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false as const,
        error: res.error,
        ...(res.developerHint ? { developer_hint: res.developerHint } : {}),
      },
      { status: res.status },
    );
  }
  return NextResponse.json({
    ok: true as const,
    label_url: res.label_url,
    numero_suivi: res.numero_suivi,
    item_ids: res.item_ids,
  });
}
