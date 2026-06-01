import { NextResponse } from "next/server";

import { cancelMemberIntakeSendcloudForArchivedShipment } from "@/lib/items/member-intake-shipment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function internalSecrets(): string[] {
  const primary = process.env.SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET?.trim() ?? "";
  const fallback = process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ?? "";
  return [...new Set([primary, fallback].filter(Boolean))];
}

/** Annule aller / retour Sendcloud liés à un shipment `member_intake` archivé (trigger DB pg_net). */
export async function POST(request: Request) {
  const candidates = internalSecrets();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { shipment_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const shipmentId = String(body.shipment_id ?? "").trim();
  if (!isUuid(shipmentId)) {
    return NextResponse.json({ ok: false as const, error: "shipment_id invalide" }, { status: 400 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false as const, error: "service_unavailable" }, { status: 503 });
  }

  const { data: ship } = await admin
    .from("shipments")
    .select("id, context")
    .eq("id", shipmentId)
    .maybeSingle();

  if (!ship?.id || String(ship.context) !== "member_intake") {
    return NextResponse.json({ ok: true as const, cancelled: false, reason: "not_member_intake" });
  }

  const result = await cancelMemberIntakeSendcloudForArchivedShipment(admin, shipmentId);
  if (!result.ok) {
    return NextResponse.json({ ok: false as const, error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true as const, cancelled: result.cancelled });
}
