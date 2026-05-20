import { NextResponse } from "next/server";

import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { processSendcloudParcelEvent } from "@/lib/sendcloud/parcel-event-handler";
import {
  isSendcloudIntegrationWebhookAuthorized,
  isSendcloudWebhookAuthorized,
} from "@/lib/sendcloud/webhook-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as JsonRecord;
}

/**
 * Webhook Sendcloud :
 * - **Intégration** (`Parcel status changed`) : URL dans les réglages d’intégration, auth HMAC `Sendcloud-Signature`
 *   sur le corps brut (`SENDCLOUD_SECRET_KEY` ou `SENDCLOUD_WEBHOOK_SECRET`).
 * - **Event Subscriptions** (`parcels.event.created`) : Bearer `SENDCLOUD_WEBHOOK_SECRET`.
 *
 * `cart_outbound` : aucune transition tant que l’expédition est `pending` — le `ready` est posé par le BO (mise en colis).
 * `cart_return` : création / synchro quand un retour portail Sendcloud est créé (même `order_number` que l’aller).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!isSendcloudWebhookAuthorized(request, rawBody)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const body = asRecord(payload);
  if (!body) {
    return NextResponse.json({ ok: false as const, error: "payload_object_required" }, { status: 400 });
  }

  const source = isSendcloudIntegrationWebhookAuthorized(request, rawBody)
    ? "sendcloud_integration_webhook"
    : "sendcloud_event_subscription";

  const admin = createSupabaseAdminClient();
  const env = getSendcloudEnv();
  const result = await processSendcloudParcelEvent(admin, env, body, { source });

  if (!result.ok) {
    return NextResponse.json({ ok: false as const, error: result.error }, { status: 500 });
  }

  if ("ignored" in result) {
    return NextResponse.json({ ok: true as const, ignored: result.ignored });
  }

  return NextResponse.json({
    ok: true as const,
    shipment_id: result.shipment_id,
    parcel_id: result.parcel_id,
    status: result.status,
    transitions: result.transitions,
    ...("provisioned" in result && result.provisioned ? { provisioned: true } : {}),
  });
}
