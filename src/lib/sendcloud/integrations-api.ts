import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelFetch, sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";

export type SendcloudIntegration = {
  id: number;
  shop_name?: string;
  /** v2 `system` / v3 `type` (ex. `api`). */
  system?: string;
  service_point_enabled?: boolean;
  service_point_carriers?: string[];
  webhook_active?: boolean;
  webhook_url?: string | null;
};

type IntegrationRowV3 = {
  id: number;
  shop_name?: string;
  type?: string;
  service_point_enabled?: boolean;
  service_point_carriers?: string[];
  webhook_active?: boolean;
  webhook_url?: string | null;
};

type IntegrationRowV2 = {
  id: number;
  shop_name?: string;
  system?: string;
  service_point_enabled?: boolean;
  service_point_carriers?: string[];
};

function normalizeIntegration(row: IntegrationRowV3 | IntegrationRowV2): SendcloudIntegration {
  const system =
    "system" in row && row.system
      ? row.system
      : "type" in row
        ? row.type
        : undefined;
  return {
    id: row.id,
    shop_name: row.shop_name,
    system,
    service_point_enabled: row.service_point_enabled,
    service_point_carriers: row.service_point_carriers,
    webhook_active: "webhook_active" in row ? row.webhook_active : undefined,
    webhook_url: "webhook_url" in row ? row.webhook_url : undefined,
  };
}

export function pickSegnaIntegration(rows: SendcloudIntegration[]): SendcloudIntegration | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    rows.find((r) => r.system === "api" && r.shop_name?.toLowerCase().includes("segna")) ??
    rows.find((r) => r.system === "api") ??
    rows.find((r) => r.shop_name?.toLowerCase().includes("segna")) ??
    rows[0] ??
    null
  );
}

export async function listSendcloudIntegrations(
  env: SendcloudEnv,
): Promise<{ ok: true; integrations: SendcloudIntegration[] } | { ok: false; error: string }> {
  const v3 = await sendcloudPanelV3Fetch<{ data: IntegrationRowV3[] }>(env, "/integrations", {
    method: "GET",
  });
  if (v3.ok && Array.isArray(v3.data.data)) {
    return { ok: true, integrations: v3.data.data.map(normalizeIntegration) };
  }

  const v2 = await sendcloudPanelFetch<IntegrationRowV2[]>(env, "/integrations", { method: "GET" });
  if (!v2.ok) {
    return { ok: false, error: v3.ok ? v2.error : v3.error };
  }
  if (!Array.isArray(v2.data)) {
    return { ok: false, error: "Sendcloud : réponse integrations invalide." };
  }
  return { ok: true, integrations: v2.data.map(normalizeIntegration) };
}
