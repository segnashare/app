import { NextResponse } from "next/server";

import { notifyShipmentLifecycleAfterTransition } from "@/lib/notifications/lifecycle-shipment-notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function internalShipmentNotifySecrets(): string[] {
  const primary = process.env.SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET?.trim() ?? "";
  const fallback = process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ?? "";
  return [...new Set([primary, fallback].filter(Boolean))];
}

/**
 * Après `transition_shipment_status` depuis le **back-office** (RPC Supabase direct, sans passer par le wrapper segna-app).
 * Déclenche e-mails et/ou SMS selon la transition (ex. livraison aller → SMS seul).
 *
 * Auth : `Authorization: Bearer` = `SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET` si défini, sinon le même secret que
 * `POST /api/internal/cart-outbound-launch-uber` (`SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET`).
 *
 * Body JSON : `{ "shipment_id": "uuid", "from_status": "pending", "to_status": "ready", "source": "backoffice_…" }`
 */
export async function POST(request: Request) {
  const candidates = internalShipmentNotifySecrets();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { shipment_id?: unknown; from_status?: unknown; to_status?: unknown; source?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const shipmentId = typeof body.shipment_id === "string" ? body.shipment_id.trim() : "";
  const fromStatus = typeof body.from_status === "string" ? body.from_status.trim() : "";
  const toStatus = typeof body.to_status === "string" ? body.to_status.trim() : "";
  const source = typeof body.source === "string" ? body.source.trim() : "";

  if (!isUuid(shipmentId)) {
    return NextResponse.json({ ok: false as const, error: "shipment_id_invalid" }, { status: 400 });
  }
  if (!fromStatus || !toStatus || !source) {
    return NextResponse.json({ ok: false as const, error: "from_status_to_status_source_required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  await notifyShipmentLifecycleAfterTransition(admin, {
    shipmentId,
    fromStatus,
    toStatus,
    source,
  });

  return NextResponse.json({ ok: true as const, shipment_id: shipmentId });
}
