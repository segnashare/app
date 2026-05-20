import { NextResponse } from "next/server";

import { runMemberIntakeReturnPortalStart } from "@/lib/items/member-intake-return-portal";
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
  const force = o.force === true;

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

  const res = await runMemberIntakeReturnPortalStart(admin, {
    userId: user.id,
    itemIds,
    force,
  });
  if (!res.ok) {
    console.error("[api/return-portal/start]", {
      userId: user.id,
      itemIds,
      force,
      status: res.status,
      error: res.error,
      developerHint: res.developerHint,
    });
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
    return_portal_url: res.return_portal_url,
    order_number: res.order_number,
    postal_code: res.postal_code,
    item_ids: res.item_ids,
  });
}
