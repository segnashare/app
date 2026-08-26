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

type ExpoReceipt = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

function expoAuthHeaders(): Record<string, string> {
  const accessToken = getServerEnv().EXPO_ACCESS_TOKEN?.trim() || null;
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

/**
 * Attend brièvement les receipts Expo.
 * - désactive les jetons `DeviceNotRegistered`
 * - retourne `false` si tous les receipts connus sont en erreur (→ fallback SMS)
 * - retourne `true` si au moins un receipt OK, ou si aucun receipt pas encore dispo
 */
async function confirmExpoPushViaReceipts(
  admin: SupabaseClient,
  input: {
    userId: string;
    ticketIds: string[];
    tokenByTicketId: Map<string, string>;
  },
): Promise<boolean> {
  if (input.ticketIds.length === 0) return false;

  try {
    // Les receipts DeviceNotRegistered arrivent souvent en quelques secondes.
    await new Promise((r) => setTimeout(r, 2_500));

    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: expoAuthHeaders(),
      body: JSON.stringify({ ids: input.ticketIds }),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: Record<string, ExpoReceipt>;
    } | null;
    if (!res.ok || !json?.data) {
      console.warn("[notifications] expo-push receipts HTTP", res.status, json);
      // Receipts indisponibles → on fait confiance aux tickets OK.
      return true;
    }

    let anyOk = false;
    let anyError = false;

    for (const ticketId of input.ticketIds) {
      const receipt = json.data[ticketId];
      if (!receipt) continue;
      if (receipt.status === "ok") {
        anyOk = true;
        continue;
      }
      if (receipt.status === "error") {
        anyError = true;
        const err = receipt.details?.error ?? receipt.message ?? "unknown";
        const token = input.tokenByTicketId.get(ticketId);
        console.warn("[notifications] expo-push receipt error", {
          userId: input.userId,
          err,
          token,
        });
        if (err === "DeviceNotRegistered" && token) {
          await disableDevicePushToken(admin, token);
        }
      }
    }

    if (anyOk) return true;
    if (anyError) return false;
    // Aucun receipt encore → tickets OK restent valides.
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] expo-push receipts failed", msg);
    return true;
  }
}

/**
 * Envoie une notification Expo Push aux appareils actifs du membre.
 * Retourne true si au moins un ticket est OK et les receipts ne contredisent pas.
 * Désactive les jetons `DeviceNotRegistered` (ticket immédiat + receipts).
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

  const payload = tokens.map((row) => ({
    to: row.expo_push_token,
    sound: message.sound === false ? null : ("default" as const),
    title: title || "Segna",
    body: body || title,
    data: message.data ?? {},
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: expoAuthHeaders(),
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
    const okTicketIds: string[] = [];
    const tokenByTicketId = new Map<string, string>();

    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i];
      const token = tokens[i]?.expo_push_token;
      if (ticket?.status === "ok") {
        anyOk = true;
        if (typeof ticket.id === "string" && ticket.id && token) {
          okTicketIds.push(ticket.id);
          tokenByTicketId.set(ticket.id, token);
        }
        continue;
      }
      const err = ticket?.details?.error ?? ticket?.message ?? "unknown";
      console.warn("[notifications] expo-push ticket error", { userId, err, token });
      if (err === "DeviceNotRegistered" && token) {
        await disableDevicePushToken(admin, token);
      }
    }

    if (!anyOk) return false;
    if (okTicketIds.length === 0) return true;

    return confirmExpoPushViaReceipts(admin, {
      userId,
      ticketIds: okTicketIds,
      tokenByTicketId,
    });
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
  const itemDisputeId =
    typeof meta.item_dispute_id === "string" ? meta.item_dispute_id.trim() : "";
  const openAlert = meta.open_item_dispute_alert === true;
  const openClemency = meta.open_return_clemency_alert === true;
  const openReturnReview = meta.open_return_review_sheet === true;

  if (itemDisputeId) data.item_dispute_id = itemDisputeId;
  if (cartId) data.cart_id = cartId;
  if (itemId) data.item_id = itemId;

  // Modale informative litige : home + refresh alerte (pas la fiche commande).
  if (openAlert) {
    data.open_item_dispute_alert = true;
    data.url = "segna://home";
    return data;
  }

  // Défaut réversible (clémence) → page commande + modale.
  if (openClemency && cartId) {
    data.open_return_clemency_alert = true;
    data.url = `segna://commande/${cartId}`;
    return data;
  }

  // Reprise OK → page retour + modale avis.
  if (openReturnReview && cartId) {
    data.open_return_review_sheet = true;
    data.url = `segna://exchange/retour/${cartId}?review=1`;
    return data;
  }

  if (cartId) {
    const deepLink =
      typeof meta.deep_link === "string" ? meta.deep_link.trim().toLowerCase() : "";
    data.url =
      deepLink === "emprunt"
        ? `segna://exchange/emprunt/${cartId}`
        : deepLink === "retour"
          ? `segna://exchange/retour/${cartId}?review=1`
          : `segna://commande/${cartId}`;
  }
  if (itemId && !data.url) {
    data.url = `segna://items/${itemId}`;
  }
  return data;
}
