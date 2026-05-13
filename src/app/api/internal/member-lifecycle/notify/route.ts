import { NextResponse } from "next/server";

import { dispatchMemberLifecycleItemEvent, memberLifecycleItemEventCodes } from "@/lib/notifications/lifecycle-item-notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Déclenche une notification membre pour une étape « pièce » (évaluation / logistique).
 * Auth : `Authorization: Bearer ${SEGNA_INTERNAL_MEMBER_LIFECYCLE_SECRET}`.
 * Body JSON : `{ "item_id": "uuid", "event": "item_evaluated" | "item_received_segna" | "item_validated_segna" }`
 * À appeler depuis le backoffice ou n8n quand `item_intake` / logistique change côté serveur.
 */
export async function POST(request: Request) {
  const expected = process.env.SEGNA_INTERNAL_MEMBER_LIFECYCLE_SECRET?.trim() ?? "";
  if (!expected) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${expected}`) {
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

  return NextResponse.json({ ok: true as const, item_id: itemId, event });
}
