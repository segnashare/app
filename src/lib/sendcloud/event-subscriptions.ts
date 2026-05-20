import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";

export const SENDCLOUD_PARCEL_EVENT_TYPE = "parcels.event.created" as const;

export type SendcloudConnectionType = "webhook" | "klaviyo";

export type SendcloudWebhookAuthType = "none" | "bearer" | "basic" | "api_key";

export type SendcloudConnection = {
  id: number;
  type: SendcloudConnectionType;
  configuration: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type SendcloudSubscription = {
  id: number;
  connection_id: number;
  event_type: typeof SENDCLOUD_PARCEL_EVENT_TYPE;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type SendcloudBroadcastResult = {
  success: boolean;
  status_code: number;
  response_body: string;
};

export async function listSendcloudConnections(
  env: SendcloudEnv,
  connectionType?: SendcloudConnectionType,
): Promise<{ ok: true; connections: SendcloudConnection[] } | { ok: false; error: string }> {
  const qs = connectionType ? `?connection_type=${encodeURIComponent(connectionType)}` : "";
  const res = await sendcloudPanelV3Fetch<{ data: SendcloudConnection[] }>(
    env,
    `/event-subscriptions/connections${qs}`,
    { method: "GET" },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, connections: res.data.data ?? [] };
}

export async function createSendcloudWebhookConnection(
  env: SendcloudEnv,
  input: {
    url: string;
    authType: SendcloudWebhookAuthType;
    authConfig?: Record<string, string>;
    extraHeaders?: Record<string, string>;
  },
): Promise<{ ok: true; connection: SendcloudConnection } | { ok: false; error: string }> {
  const configuration: Record<string, unknown> = {
    url: input.url,
    auth_type: input.authType,
  };
  if (input.authConfig && Object.keys(input.authConfig).length > 0) {
    configuration.auth_config = input.authConfig;
  }
  if (input.extraHeaders && Object.keys(input.extraHeaders).length > 0) {
    configuration.extra_headers = input.extraHeaders;
  }

  const res = await sendcloudPanelV3Fetch<{ data: SendcloudConnection }>(
    env,
    "/event-subscriptions/connections",
    {
      method: "POST",
      body: JSON.stringify({ type: "webhook", configuration }),
    },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, connection: res.data.data };
}

export async function listSendcloudSubscriptions(
  env: SendcloudEnv,
): Promise<{ ok: true; subscriptions: SendcloudSubscription[] } | { ok: false; error: string }> {
  const res = await sendcloudPanelV3Fetch<{ data: SendcloudSubscription[] }>(
    env,
    "/event-subscriptions/subscriptions",
    { method: "GET" },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, subscriptions: res.data.data ?? [] };
}

export async function createSendcloudSubscription(
  env: SendcloudEnv,
  input: { connectionId: number; eventType?: typeof SENDCLOUD_PARCEL_EVENT_TYPE; isActive?: boolean },
): Promise<{ ok: true; subscription: SendcloudSubscription } | { ok: false; error: string }> {
  const res = await sendcloudPanelV3Fetch<{ data: SendcloudSubscription }>(
    env,
    "/event-subscriptions/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        connection_id: input.connectionId,
        event_type: input.eventType ?? SENDCLOUD_PARCEL_EVENT_TYPE,
        is_active: input.isActive !== false,
      }),
    },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, subscription: res.data.data };
}

export async function broadcastSendcloudTestEvent(
  env: SendcloudEnv,
  subscriptionId: number,
): Promise<{ ok: true; result: SendcloudBroadcastResult } | { ok: false; error: string }> {
  const res = await sendcloudPanelV3Fetch<{ data: SendcloudBroadcastResult }>(
    env,
    `/event-subscriptions/broadcast/test/${subscriptionId}`,
    { method: "POST" },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, result: res.data.data };
}

export function resolveSendcloudWebhookPublicUrl(): string | null {
  const explicit = process.env.SENDCLOUD_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const app = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (app?.startsWith("http")) return `${app.replace(/\/$/, "")}/api/sendcloud/webhook`;

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}/api/sendcloud/webhook`;

  return null;
}

/**
 * Crée (si besoin) une connexion webhook + abonnement `parcels.event.created`.
 * Idempotent : réutilise une connexion sur la même URL.
 */
export async function ensureSendcloudParcelEventWebhook(
  env: SendcloudEnv,
  input: { webhookUrl: string; bearerToken: string },
): Promise<
  | {
      ok: true;
      connectionId: number;
      subscriptionId: number;
      createdConnection: boolean;
      createdSubscription: boolean;
    }
  | { ok: false; error: string }
> {
  const targetUrl = input.webhookUrl.trim();
  if (!targetUrl.startsWith("https://")) {
    return { ok: false, error: "URL webhook Sendcloud : HTTPS requis." };
  }

  const listed = await listSendcloudConnections(env, "webhook");
  if (!listed.ok) return { ok: false, error: listed.error };

  let connection = listed.connections.find((c) => {
    const url = c.configuration?.url;
    return typeof url === "string" && url.trim() === targetUrl;
  });
  let createdConnection = false;

  if (!connection) {
    const created = await createSendcloudWebhookConnection(env, {
      url: targetUrl,
      authType: "bearer",
      authConfig: { token: input.bearerToken },
    });
    if (!created.ok) return { ok: false, error: created.error };
    connection = created.connection;
    createdConnection = true;
  }

  const subs = await listSendcloudSubscriptions(env);
  if (!subs.ok) return { ok: false, error: subs.error };

  let subscription = subs.subscriptions.find(
    (s) => s.connection_id === connection!.id && s.event_type === SENDCLOUD_PARCEL_EVENT_TYPE,
  );
  let createdSubscription = false;

  if (!subscription) {
    const created = await createSendcloudSubscription(env, { connectionId: connection.id });
    if (!created.ok) return { ok: false, error: created.error };
    subscription = created.subscription;
    createdSubscription = true;
  }

  return {
    ok: true,
    connectionId: connection.id,
    subscriptionId: subscription.id,
    createdConnection,
    createdSubscription,
  };
}
