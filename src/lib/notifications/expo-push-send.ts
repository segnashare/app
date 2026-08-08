import "server-only";

import { getServerEnv } from "@/lib/config/env";
import {
  disableDevicePushToken,
  listActiveDevicePushTokens,
} from "@/lib/notifications/device-push-tokens";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ExpoPushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: boolean;
};

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Envoie une notification Expo Push aux appareils actifs du membre.
 * Retourne true si au moins un ticket est OK.
 * Désactive les jetons `DeviceNotRegistered`.
 */
export async function sendExpoPushToUser(
  admin: SupabaseClient,
  userId: string,
  message: ExpoPushMessage,
): Promise<boolean> {
  const tokens = await listActiveDevicePushTokens(admin, userId);
  if (tokens.length === 0) return false;

  const title = message.title.trim().slice(0, 80);
  const body = message.body.trim().slice(0, 240);
  if (!title && !body) return false;

  const accessToken = getServerEnv().EXPO_ACCESS_TOKEN?.trim() || null;
  const payload = tokens.map((row) => ({
    to: row.expo_push_token,
    sound: message.sound === false ? null : ("default" as const),
    title: title || "Segna",
    body: body || title,
    data: message.data ?? {},
  }));

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const json = (await res.json().catch(() => null)) as
      | { data?: ExpoTicket | ExpoTicket[]; errors?: unknown }
      | null;

    if (!res.ok) {
      console.error("[notifications] expo-push HTTP", res.status, json);
      return false;
    }

    const tickets = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : [];
    let anyOk = false;

    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i];
      const token = tokens[i]?.expo_push_token;
      if (ticket?.status === "ok") {
        anyOk = true;
        continue;
      }
      const err = ticket?.details?.error ?? ticket?.message ?? "unknown";
      console.warn("[notifications] expo-push ticket error", { userId, err, token });
      if (err === "DeviceNotRegistered" && token) {
        await disableDevicePushToken(admin, token);
      }
    }

    return anyOk;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] expo-push send failed", msg);
    return false;
  }
}

export function buildMemberPushData(input: {
  kind: string;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  const data: Record<string, unknown> = { kind: input.kind };
  const meta = input.metadata ?? {};
  const cartId = typeof meta.cart_id === "string" ? meta.cart_id.trim() : "";
  const itemId = typeof meta.item_id === "string" ? meta.item_id.trim() : "";
  if (cartId) {
    data.cart_id = cartId;
    data.url = `segna://commande/${cartId}`;
  }
  if (itemId) {
    data.item_id = itemId;
    if (!data.url) data.url = `segna://items/${itemId}`;
  }
  return data;
}
