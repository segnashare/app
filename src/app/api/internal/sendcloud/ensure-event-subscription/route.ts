import { NextResponse } from "next/server";

import { getSendcloudEnv } from "@/lib/sendcloud/config";
import {
  broadcastSendcloudTestEvent,
  ensureSendcloudParcelEventWebhook,
  resolveSendcloudWebhookPublicUrl,
} from "@/lib/sendcloud/event-subscriptions";

function internalSecrets(): string[] {
  const dedicated = process.env.SEGNA_INTERNAL_SENDCLOUD_SETUP_SECRET?.trim() ?? "";
  const ship = process.env.SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET?.trim() ?? "";
  const uber = process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ?? "";
  return [...new Set([dedicated, ship, uber].filter(Boolean))];
}

/**
 * Provisionne connexion webhook + abonnement `parcels.event.created` côté Sendcloud.
 *
 * Auth : `Authorization: Bearer` = `SEGNA_INTERNAL_SENDCLOUD_SETUP_SECRET` (ou secrets internes existants).
 * Body optionnel : `{ "test_broadcast": true }` pour envoyer un événement test après création.
 */
export async function POST(request: Request) {
  const candidates = internalSecrets();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  const env = getSendcloudEnv();
  if (!env) {
    return NextResponse.json({ ok: false as const, error: "sendcloud_not_configured" }, { status: 503 });
  }

  const webhookSecret = process.env.SENDCLOUD_WEBHOOK_SECRET?.trim() ?? "";
  if (!webhookSecret) {
    return NextResponse.json({ ok: false as const, error: "SENDCLOUD_WEBHOOK_SECRET_missing" }, { status: 503 });
  }

  const webhookUrl = resolveSendcloudWebhookPublicUrl();
  if (!webhookUrl) {
    return NextResponse.json(
      { ok: false as const, error: "webhook_url_unresolvable (SENDCLOUD_WEBHOOK_URL ou NEXT_PUBLIC_APP_URL)" },
      { status: 503 },
    );
  }

  let testBroadcast = false;
  try {
    const body = (await request.json()) as { test_broadcast?: boolean };
    testBroadcast = body?.test_broadcast === true;
  } catch {
    // body vide OK
  }

  const ensured = await ensureSendcloudParcelEventWebhook(env, {
    webhookUrl,
    bearerToken: webhookSecret,
  });
  if (!ensured.ok) {
    return NextResponse.json({ ok: false as const, error: ensured.error }, { status: 502 });
  }

  let broadcast: { success: boolean; status_code: number } | null = null;
  if (testBroadcast) {
    const test = await broadcastSendcloudTestEvent(env, ensured.subscriptionId);
    if (test.ok) {
      broadcast = {
        success: test.result.success,
        status_code: test.result.status_code,
      };
    }
  }

  return NextResponse.json({
    ok: true as const,
    webhook_url: webhookUrl,
    connection_id: ensured.connectionId,
    subscription_id: ensured.subscriptionId,
    created_connection: ensured.createdConnection,
    created_subscription: ensured.createdSubscription,
    test_broadcast: broadcast,
  });
}
