import { NextResponse } from "next/server";

import { notifyShipmentLifecycleAfterTransition } from "@/lib/notifications/lifecycle-shipment-notify";
import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as JsonRecord;
}

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function readNested(obj: JsonRecord | null, path: string): unknown {
  if (!obj) return null;
  const keys = path.split(".");
  let cur: unknown = obj;
  for (const key of keys) {
    const rec = asRecord(cur);
    if (!rec) return null;
    cur = rec[key];
  }
  return cur;
}

function extractDeliveryId(payload: JsonRecord): string | null {
  const candidates: unknown[] = [
    payload.delivery_id,
    payload.resource_id,
    payload.id,
    readNested(payload, "delivery_id"),
    readNested(payload, "delivery.id"),
    readNested(payload, "data.delivery_id"),
    readNested(payload, "data.id"),
    readNested(payload, "event.delivery_id"),
    readNested(payload, "event.data.delivery_id"),
    readNested(payload, "meta.resource_id"),
    readNested(payload, "resource.id"),
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s.startsWith("del_")) return s;
  }
  return null;
}

function extractTrackingUrl(payload: JsonRecord): string | null {
  const candidates: unknown[] = [
    payload.tracking_url,
    readNested(payload, "delivery.tracking_url"),
    readNested(payload, "data.tracking_url"),
    readNested(payload, "event.data.tracking_url"),
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
  }
  return null;
}

function mapUberStatusToShipmentStatus(payload: JsonRecord): "in_transit_in" | "delivered" | "failed" | null {
  const statuses: string[] = [
    norm(payload.status),
    norm(payload.delivery_status),
    norm(payload.current_status),
    norm(readNested(payload, "delivery.status")),
    norm(readNested(payload, "data.status")),
    norm(readNested(payload, "data.delivery_status")),
    norm(readNested(payload, "event.data.status")),
    norm(readNested(payload, "event.data.delivery_status")),
    norm(readNested(payload, "status_change.to")),
    norm(readNested(payload, "delivery_status_change.to")),
  ].filter(Boolean);

  for (const st of statuses) {
    if (
      st === "delivered" ||
      st === "dropoff_complete" ||
      st === "completed" ||
      st === "proof_of_delivery"
    ) {
      return "delivered";
    }
  }
  for (const st of statuses) {
    if (
      st === "in_transit" ||
      st === "in_progress" ||
      st === "pickup_complete" ||
      st === "courier_en_route" ||
      st === "en_route_to_dropoff" ||
      st === "en_route_to_pickup" ||
      st === "picked_up"
    ) {
      return "in_transit_in";
    }
  }
  for (const st of statuses) {
    if (
      st === "canceled" ||
      st === "cancelled" ||
      st === "failed" ||
      st === "undeliverable" ||
      st === "return_to_sender"
    ) {
      return "failed";
    }
  }
  return null;
}

function isWebhookAuthorized(request: Request): boolean {
  const expected = process.env.UBER_DIRECT_WEBHOOK_SECRET?.trim() ?? "";
  if (!expected) return true;
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const tokenHeader = request.headers.get("x-segna-uber-webhook-secret")?.trim() ?? "";
  if (tokenHeader && tokenHeader === expected) return true;
  const url = new URL(request.url);
  const tokenQuery = (url.searchParams.get("token") ?? "").trim();
  if (tokenQuery && tokenQuery === expected) return true;
  return false;
}

async function advanceStatus(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  shipmentId: string,
  current: string,
  target: "in_transit_in" | "delivered" | "failed",
  deliveryId: string,
  payload: JsonRecord,
): Promise<{ ok: true; status: string; didTransition: boolean } | { ok: false; error: string }> {
  const nowIso = new Date().toISOString();
  let expectedCurrent = current;

  if (current === target) return { ok: true, status: current, didTransition: false };

  // Legacy enum `in_transit` → `in_transit_in` (certaines lignes n’ont pas reçu la migration).
  if (current === "in_transit") {
    const migrate = await transitionShipmentStatus(admin as any, {
      shipmentId,
      ifCurrentStatus: "in_transit",
      toStatus: "in_transit_in",
      actorUserId: null,
      reason: "Uber webhook: normalisation in_transit → in_transit_in",
      source: "uber_direct_webhook",
      context: { delivery_id: deliveryId, payload_type: payload.event_type ?? payload.type ?? null },
      occurredAt: nowIso,
      trackingNumber: deliveryId,
      setReadyAt: false,
    });
    if (migrate.ok) {
      current = "in_transit_in";
      expectedCurrent = "in_transit_in";
    } else if (migrate.error !== "STATUS_MISMATCH") {
      return migrate;
    } else {
      const { data: fresh } = await admin.from("shipments").select("status").eq("id", shipmentId).maybeSingle();
      const freshSt = norm((fresh as { status?: unknown } | null)?.status);
      if (freshSt === "in_transit_in") {
        current = "in_transit_in";
        expectedCurrent = "in_transit_in";
      }
    }
    if (current === target) return { ok: true, status: current, didTransition: false };
  }

  // Cas courant Uber: ready -> in_transit_in -> delivered.
  if (target === "delivered" && current === "ready") {
    const step1 = await transitionShipmentStatus(admin as any, {
      shipmentId,
      ifCurrentStatus: "ready",
      toStatus: "in_transit_in",
      actorUserId: null,
      reason: "Uber webhook: passage en transit",
      source: "uber_direct_webhook",
      context: { delivery_id: deliveryId, payload_type: payload.event_type ?? payload.type ?? null },
      occurredAt: nowIso,
      trackingNumber: deliveryId,
      setReadyAt: false,
    });
    if (!step1.ok && step1.error !== "STATUS_MISMATCH") return step1;
    expectedCurrent = "in_transit_in";
  }

  const tr = await transitionShipmentStatus(admin as any, {
    shipmentId,
    ifCurrentStatus: expectedCurrent,
    toStatus: target,
    actorUserId: null,
    reason: `Uber webhook: ${target}`,
    source: "uber_direct_webhook",
    context: { delivery_id: deliveryId, payload_type: payload.event_type ?? payload.type ?? null },
    occurredAt: nowIso,
    trackingNumber: deliveryId,
    setReadyAt: false,
  });
  if (!tr.ok && tr.error === "STATUS_MISMATCH") {
    const { data: fresh } = await admin.from("shipments").select("status").eq("id", shipmentId).maybeSingle();
    const freshSt = norm((fresh as { status?: unknown } | null)?.status);
    if (freshSt === target) return { ok: true, status: target, didTransition: false };
  }
  return tr.ok ? { ok: true, status: target, didTransition: true } : tr;
}

/** Si le colis est déjà `delivered` en base, le RPC ne tourne pas → rattrapage notif récap. */
async function catchUpOutboundDeliveredRecap(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  shipmentId: string,
  priorStatus: string,
): Promise<void> {
  const from =
    priorStatus === "delivered" || priorStatus === "closed" ? "in_transit_in" : priorStatus;
  await notifyShipmentLifecycleAfterTransition(admin, {
    shipmentId,
    fromStatus: from,
    toStatus: "delivered",
    source: "uber_direct_webhook_catchup",
  });
}

export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }
  const body = asRecord(payload);
  if (!body) {
    return NextResponse.json({ ok: false as const, error: "payload_object_required" }, { status: 400 });
  }

  const deliveryId = extractDeliveryId(body);
  if (!deliveryId) {
    return NextResponse.json({ ok: true as const, ignored: "delivery_id_missing" as const });
  }
  const targetStatus = mapUberStatusToShipmentStatus(body);
  if (!targetStatus) {
    return NextResponse.json({ ok: true as const, ignored: "status_unmapped" as const, delivery_id: deliveryId });
  }

  const admin = createSupabaseAdminClient();
  const { data: ship, error: shipErr } = await admin
    .from("shipments")
    .select("id, status, member_tracking_url")
    .eq("context", "cart_outbound")
    .eq("tracking_number", deliveryId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shipErr || !ship || typeof (ship as { id?: unknown }).id !== "string") {
    return NextResponse.json({ ok: true as const, ignored: "shipment_not_found" as const, delivery_id: deliveryId });
  }

  const shipmentId = (ship as { id: string }).id;
  const current = norm((ship as { status?: unknown }).status);
  const res = await advanceStatus(admin, shipmentId, current, targetStatus, deliveryId, body);
  if (!res.ok) {
    return NextResponse.json({ ok: false as const, error: res.error, shipment_id: shipmentId }, { status: 500 });
  }

  if (targetStatus === "delivered" && !res.didTransition) {
    await catchUpOutboundDeliveredRecap(admin, shipmentId, current);
  }

  const trackingUrl = extractTrackingUrl(body);
  if (trackingUrl) {
    await admin
      .from("shipments")
      .update({ member_tracking_url: trackingUrl, updated_at: new Date().toISOString() })
      .eq("id", shipmentId)
      .eq("context", "cart_outbound");
  }

  return NextResponse.json({
    ok: true as const,
    shipment_id: shipmentId,
    delivery_id: deliveryId,
    status: res.status,
  });
}
