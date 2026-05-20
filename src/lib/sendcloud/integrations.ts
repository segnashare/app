import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { getSendcloudSppCarriersFromEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelFetch } from "@/lib/sendcloud/client";
import {
  listSendcloudIntegrations,
  pickSegnaIntegration,
} from "@/lib/sendcloud/integrations-api";

/** Transporteurs point relais activés sur l’intégration Segna. */
export async function resolveSendcloudSppCarriers(env: SendcloudEnv): Promise<string[]> {
  const fromEnv = getSendcloudSppCarriersFromEnv();
  const listed = await listSendcloudIntegrations(env);

  if (!listed.ok) {
    return fromEnv.length > 0 ? fromEnv : ["mondial_relay", "colissimo"];
  }

  const integration = pickSegnaIntegration(listed.integrations);
  const enabled = (integration?.service_point_carriers ?? [])
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  if (enabled.length === 0) {
    return fromEnv.length > 0 ? fromEnv : ["mondial_relay", "colissimo"];
  }

  if (process.env.SENDCLOUD_SPP_CARRIERS?.trim()) {
    const allowed = fromEnv.filter((c) => enabled.includes(c));
    return allowed.length > 0 ? allowed : enabled;
  }

  return enabled;
}

export async function resolveSendcloudIntegrationId(env: SendcloudEnv): Promise<number | null> {
  if (env.integrationId > 0) return env.integrationId;

  const listed = await listSendcloudIntegrations(env);
  if (!listed.ok) return null;

  const pick = pickSegnaIntegration(listed.integrations);
  return typeof pick?.id === "number" ? pick.id : null;
}

export async function resolveSendcloudSenderAddressId(env: SendcloudEnv): Promise<number | null> {
  if (env.senderAddressId) return env.senderAddressId;

  const res = await sendcloudPanelFetch<{ sender_addresses: { id: number }[] }>(
    env,
    "/user/addresses/sender",
    { method: "GET" },
  );
  if (!res.ok) return null;
  const list = res.data.sender_addresses;
  if (!Array.isArray(list) || list.length === 0) return null;
  return typeof list[0]?.id === "number" ? list[0].id : null;
}
