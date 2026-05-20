import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";

export type SendcloudParcelStatusCode = {
  code: string;
  message: string;
};

/** Code v3 Sendcloud pour colis annulé (remplace l’id numérique 2000 en v2). */
export const SENDCLOUD_V3_PARCEL_STATUS_CANCELLED = "CANCELLED";

let cachedStatuses: SendcloudParcelStatusCode[] | null = null;

export async function listSendcloudParcelStatuses(
  env: SendcloudEnv,
  options?: { refresh?: boolean },
): Promise<{ ok: true; statuses: SendcloudParcelStatusCode[] } | { ok: false; error: string }> {
  if (!options?.refresh && cachedStatuses) {
    return { ok: true, statuses: cachedStatuses };
  }

  const res = await sendcloudPanelV3Fetch<{ data: SendcloudParcelStatusCode[] }>(
    env,
    "/parcels/statuses",
    { method: "GET" },
  );
  if (!res.ok) return { ok: false, error: res.error };

  cachedStatuses = res.data.data ?? [];
  return { ok: true, statuses: cachedStatuses };
}

export function isSendcloudV3StatusCancelled(code: string | undefined, message?: string): boolean {
  const c = String(code ?? "").toUpperCase();
  const m = String(message ?? "").toLowerCase();
  return c === SENDCLOUD_V3_PARCEL_STATUS_CANCELLED || m.includes("cancel");
}
