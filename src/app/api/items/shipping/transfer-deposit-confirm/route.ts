import { NextResponse } from "next/server";

import { runMemberIntakeTransferDepositConfirm } from "@/lib/items/member-intake-transfer-deposit-confirm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const shipmentId = String(o.shipment_id ?? "").trim();
  const presentItemIds = Array.isArray(o.present_item_ids)
    ? [...new Set(o.present_item_ids.map((x) => String(x ?? "").trim()).filter(isUuid))]
    : [];

  if (!isUuid(shipmentId)) {
    return NextResponse.json({ ok: false as const, error: "shipment_id requis" }, { status: 400 });
  }
  if (presentItemIds.length === 0) {
    return NextResponse.json({ ok: false as const, error: "present_item_ids requis" }, { status: 400 });
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

  const res = await runMemberIntakeTransferDepositConfirm(admin, {
    userId: user.id,
    shipmentId,
    presentItemIds,
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false as const, error: res.error }, { status: res.status });
  }

  return NextResponse.json({ ok: true as const });
}
