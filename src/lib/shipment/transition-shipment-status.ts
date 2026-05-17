import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyShipmentLifecycleAfterTransition } from "@/lib/notifications/lifecycle-shipment-notify";

export type TransitionShipmentStatusParams = {
  shipmentId: string;
  ifCurrentStatus: string;
  toStatus: string;
  actorUserId?: string | null;
  reason?: string | null;
  source: string;
  context?: Record<string, unknown>;
  occurredAt?: string | null;
  setReadyAt?: boolean;
  trackingNumber?: string | null;
};

export function parseTransitionShipmentStatusResult(
  data: unknown,
): { ok: true; historyId: string } | { ok: false; error: string } {
  const row = data as { ok?: boolean; error?: string; history_id?: string } | null;
  if (row && row.ok === true && typeof row.history_id === "string") {
    return { ok: true, historyId: row.history_id };
  }
  const err = row && typeof row.error === "string" ? row.error : "transition_shipment_status";
  return { ok: false, error: err };
}

export async function transitionShipmentStatus(
  admin: SupabaseClient,
  params: TransitionShipmentStatusParams,
): Promise<{ ok: true; historyId: string } | { ok: false; error: string }> {
  const tn = params.trackingNumber?.trim();
  const { data, error } = await admin.rpc("transition_shipment_status", {
    p_shipment_id: params.shipmentId,
    p_if_current_status: params.ifCurrentStatus,
    p_to_status: params.toStatus,
    p_actor_user_id: params.actorUserId ?? null,
    p_reason: params.reason ?? null,
    p_source: params.source,
    p_context: params.context ?? {},
    p_occurred_at: params.occurredAt ?? null,
    p_set_ready_at: params.setReadyAt !== false,
    p_tracking_number: tn && tn.length > 0 ? tn : null,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const parsed = parseTransitionShipmentStatusResult(data);
  if (parsed.ok) {
    try {
      await notifyShipmentLifecycleAfterTransition(admin, {
        shipmentId: params.shipmentId,
        fromStatus: params.ifCurrentStatus,
        toStatus: params.toStatus,
        source: params.source,
      });
    } catch (e) {
      console.error("[transition_shipment_status] lifecycle notify", e);
    }
  }
  return parsed;
}
