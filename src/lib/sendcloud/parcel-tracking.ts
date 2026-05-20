import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";

export type ParcelTrackingEvent = {
  event_at?: string;
  event_type?: string;
  phase?: string;
  description?: string;
  exception?: string;
  sub_status?: string;
  status_code?: string;
  status_description?: string;
  status_type?: string;
  sub_status_code?: string;
};

export type ParcelTrackingResponse = {
  announced_at?: string;
  created_at?: string;
  updated_at?: string;
  source_id?: string;
  tracking_numbers?: {
    carrier_code?: string;
    tracking_number?: string;
    tracking_url?: string | null;
  }[];
  events?: ParcelTrackingEvent[];
};

function normalizeTrackingPayload(raw: unknown): ParcelTrackingResponse {
  if (!raw || typeof raw !== "object") return {};
  const root = raw as Record<string, unknown>;
  const inner =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;
  return inner as ParcelTrackingResponse;
}

export function trackingEventStatusCode(event: ParcelTrackingEvent): string {
  const code = String(event.status_code ?? "").trim();
  if (code) return code.toUpperCase();

  const phase = String(event.phase ?? "").trim();
  if (!phase) return "";

  return phase.toUpperCase().replace(/-/g, "_");
}

export function trackingEventStatusMessage(event: ParcelTrackingEvent): string {
  return String(event.status_description ?? event.description ?? "").trim();
}

export async function getSendcloudParcelTracking(
  env: SendcloudEnv,
  trackingNumber: string,
): Promise<{ ok: true; tracking: ParcelTrackingResponse } | { ok: false; error: string }> {
  const tn = trackingNumber.trim();
  if (!tn) return { ok: false, error: "Numéro de suivi manquant." };

  const res = await sendcloudPanelV3Fetch<unknown>(
    env,
    `/parcels/tracking/${encodeURIComponent(tn)}`,
    { method: "GET" },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, tracking: normalizeTrackingPayload(res.data) };
}

export function latestTrackingStatusCode(tracking: ParcelTrackingResponse): string {
  const events = tracking.events ?? [];
  if (events.length === 0) return "";
  const sorted = [...events].sort((a, b) => {
    const ta = a.event_at ? Date.parse(a.event_at) : 0;
    const tb = b.event_at ? Date.parse(b.event_at) : 0;
    return tb - ta;
  });
  return trackingEventStatusCode(sorted[0] ?? {});
}
