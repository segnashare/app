import type { SupabaseClient } from "@supabase/supabase-js";

import { readCoursierConfig } from "@/lib/coursier/config";
import { mapCoursierStateToShipmentStatus } from "@/lib/coursier/map-tracking-state";
import { fetchCoursierTracking } from "@/lib/coursier/tracking-api";
import { notifyShipmentLifecycleAfterTransition } from "@/lib/notifications/lifecycle-shipment-notify";
import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

async function advanceCoursierShipmentStatus(
  admin: SupabaseClient,
  shipmentId: string,
  current: string,
  target: "in_transit_in" | "delivered" | "failed",
  missionNumber: string,
  coursierState: string,
): Promise<{ ok: true; status: string; didTransition: boolean } | { ok: false; error: string }> {
  const nowIso = new Date().toISOString();
  let expectedCurrent = current;

  if (current === target) return { ok: true, status: current, didTransition: false };

  if (target === "delivered" && current === "ready") {
    const step1 = await transitionShipmentStatus(admin, {
      shipmentId,
      ifCurrentStatus: "ready",
      toStatus: "in_transit_in",
      actorUserId: null,
      reason: "Coursier tracking: passage en transit",
      source: "coursier_tracking",
      context: { mission_number: missionNumber, coursier_state: coursierState },
      occurredAt: nowIso,
      trackingNumber: missionNumber,
      setReadyAt: false,
    });
    if (!step1.ok && step1.error !== "STATUS_MISMATCH") return step1;
    expectedCurrent = "in_transit_in";
  }

  const tr = await transitionShipmentStatus(admin, {
    shipmentId,
    ifCurrentStatus: expectedCurrent,
    toStatus: target,
    actorUserId: null,
    reason: `Coursier tracking: ${coursierState}`,
    source: "coursier_tracking",
    context: { mission_number: missionNumber, coursier_state: coursierState },
    occurredAt: nowIso,
    trackingNumber: missionNumber,
    setReadyAt: false,
  });

  if (!tr.ok && tr.error === "STATUS_MISMATCH") {
    const { data: fresh } = await admin.from("shipments").select("status").eq("id", shipmentId).maybeSingle();
    const freshSt = norm((fresh as { status?: unknown } | null)?.status);
    if (freshSt === target) return { ok: true, status: target, didTransition: false };
  }

  return tr.ok ? { ok: true, status: target, didTransition: true } : tr;
}

export type SyncCoursierShipmentTrackingResult = {
  scanned: number;
  updated: number;
  errors: string[];
};

/**
 * Interroge `tracking.php` et fait avancer les expéditions aller Coursier.
 * Cible une mission (`missionNumber`) ou toutes les missions actives si omis.
 */
export async function syncCoursierShipmentTracking(
  admin: SupabaseClient,
  scope: { shipmentId?: string | null; missionNumber?: string; cartId?: string },
): Promise<SyncCoursierShipmentTrackingResult> {
  const config = readCoursierConfig();
  const result: SyncCoursierShipmentTrackingResult = { scanned: 0, updated: 0, errors: [] };
  if (!config) return result;

  let missionNumber = scope.missionNumber?.trim() ?? "";
  let shipmentId = scope.shipmentId?.trim() ?? "";

  if (!missionNumber && shipmentId) {
    const { data: ship } = await admin
      .from("shipments")
      .select("id, tracking_number, status")
      .eq("id", shipmentId)
      .eq("context", "cart_outbound")
      .maybeSingle();
    missionNumber = String((ship as { tracking_number?: string } | null)?.tracking_number ?? "").trim();
  }

  if (!missionNumber && scope.cartId) {
    const { data: ship } = await admin
      .from("shipments")
      .select("id, tracking_number, status")
      .eq("cart_id", scope.cartId)
      .eq("context", "cart_outbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    shipmentId = String((ship as { id?: string } | null)?.id ?? "");
    missionNumber = String((ship as { tracking_number?: string } | null)?.tracking_number ?? "").trim();
  }

  if (!missionNumber) {
    return syncAllActiveCoursierShipments(admin, config);
  }

  result.scanned = 1;
  try {
    const rows = await fetchCoursierTracking({ config, missionNumber });
    const row = rows[0];
    if (!row) return result;

    if (!shipmentId) {
      const { data: ship } = await admin
        .from("shipments")
        .select("id, status, member_tracking_url")
        .eq("context", "cart_outbound")
        .eq("tracking_number", missionNumber)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!ship || typeof (ship as { id?: unknown }).id !== "string") return result;
      shipmentId = (ship as { id: string }).id;
    }

    const { data: statusRow } = await admin.from("shipments").select("status").eq("id", shipmentId).maybeSingle();
    const current = norm((statusRow as { status?: unknown } | null)?.status);
    const target = mapCoursierStateToShipmentStatus(row.State);
    if (!target) return result;

    const priorStatus = current;
    const res = await advanceCoursierShipmentStatus(
      admin,
      shipmentId,
      current,
      target,
      missionNumber,
      row.State,
    );
    if (!res.ok) {
      result.errors.push(res.error);
      return result;
    }
    if (res.didTransition) result.updated += 1;
    if (target === "delivered" && !res.didTransition) {
      await notifyShipmentLifecycleAfterTransition(admin, {
        shipmentId,
        fromStatus: priorStatus === "delivered" ? "in_transit_in" : priorStatus,
        toStatus: "delivered",
        source: "coursier_tracking_catchup",
      });
    }

    if (row.Picture?.trim()) {
      await admin
        .from("shipments")
        .update({ member_tracking_url: row.Picture.trim(), updated_at: new Date().toISOString() })
        .eq("id", shipmentId)
        .eq("context", "cart_outbound");
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
  }

  return result;
}

async function syncAllActiveCoursierShipments(
  admin: SupabaseClient,
  config: NonNullable<ReturnType<typeof readCoursierConfig>>,
): Promise<SyncCoursierShipmentTrackingResult> {
  const result: SyncCoursierShipmentTrackingResult = { scanned: 0, updated: 0, errors: [] };

  const { data: provider } = await admin
    .from("shipment_providers")
    .select("id")
    .eq("code", "coursier")
    .maybeSingle();
  const providerId =
    provider && typeof provider === "object" && typeof (provider as { id?: unknown }).id === "string"
      ? (provider as { id: string }).id
      : null;
  if (!providerId) return result;

  const { data: ships, error } = await admin
    .from("shipments")
    .select("id, tracking_number, status")
    .eq("context", "cart_outbound")
    .eq("provider_id", providerId)
    .in("status", ["ready", "in_transit_in"])
    .is("deleted_at", null)
    .not("tracking_number", "is", null)
    .order("updated_at", { ascending: true })
    .limit(40);

  if (error) {
    result.errors.push(error.message);
    return result;
  }

  for (const ship of ships ?? []) {
    const missionNumber = String((ship as { tracking_number?: string }).tracking_number ?? "").trim();
    if (!missionNumber) continue;
    result.scanned += 1;
    const partial = await syncCoursierShipmentTracking(admin, {
      shipmentId: String((ship as { id: string }).id),
      missionNumber,
    });
    result.updated += partial.updated;
    result.errors.push(...partial.errors);
  }

  return result;
}
