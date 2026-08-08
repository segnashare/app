import { NextResponse } from "next/server";

import { dispatchMemberLifecycleItemEvent, memberLifecycleItemEventCodes } from "@/lib/notifications/lifecycle-item-notify";
import { flushServerAnalytics } from "@/lib/analytics/track-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function internalMemberLifecycleSecrets(): string[] {
  const primary = process.env.SEGNA_INTERNAL_MEMBER_LIFECYCLE_SECRET?.trim() ?? "";
  const itemIntake = process.env.SEGNA_INTERNAL_ITEM_INTAKE_EVALUATION_SECRET?.trim() ?? "";
  const uber = process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ?? "";
  return [...new Set([primary, itemIntake, uber].filter(Boolean))];
}

/**
 * Déclenche une notification membre pour une étape « pièce » (évaluation / logistique).
 * Auth : Bearer = `SEGNA_INTERNAL_MEMBER_LIFECYCLE_SECRET` (ou repli item-intake / Uber interne).
 * Body JSON : `{ "item_id": "uuid", "event": "item_evaluated" | … | "item_intake_verified" | "item_became_available" }`
 * `item_intake_verified` : BO bouton Vérification (SMS propriétaire + règles likers).
 * `item_became_available` : BO bascule listed → available (règles likers seulement).
 */
export async function POST(request: Request) {
  const candidates = internalMemberLifecycleSecrets();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { item_id?: unknown; event?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
  const event = typeof body.event === "string" ? body.event.trim() : "";
  if (!isUuid(itemId)) {
    return NextResponse.json({ ok: false as const, error: "item_id_invalid" }, { status: 400 });
  }
  if (!(memberLifecycleItemEventCodes as readonly string[]).includes(event)) {
    return NextResponse.json(
      {
        ok: false as const,
        error: "event_invalid",
        allowed: [...memberLifecycleItemEventCodes],
      },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  await dispatchMemberLifecycleItemEvent(admin, { itemId, event: event as (typeof memberLifecycleItemEventCodes)[number] });
  await flushServerAnalytics();

  return NextResponse.json({ ok: true as const, item_id: itemId, event });
}
