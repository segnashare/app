import { NextResponse } from "next/server";

import { SMS_NOTIFICATION_IMPACT_BY_KIND } from "@/lib/analytics/sms-impact-catalog";
import { flushServerAnalytics } from "@/lib/analytics/track-server";
import { trackNotificationSentServer } from "@/lib/analytics/track-notification-sent-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DEV_SEED_IDEMPOTENCY_PREFIX = "dev-seed:posthog:notification_sent";

/**
 * Dev uniquement : envoie un `notification_sent` PostHog par type de SMS (sans Twilio).
 * POST /api/dev/seed-notification-sent
 * Body optionnel : `{ "user_id": "uuid" }` — sinon 1er user actif trouvé.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ ok: false, error: "dev_only" }, { status: 403 });
  }

  let userId: string | undefined;
  try {
    const body = (await request.json().catch(() => null)) as { user_id?: unknown } | null;
    if (typeof body?.user_id === "string" && body.user_id.trim()) {
      userId = body.user_id.trim();
    }
  } catch {
    // ignore
  }

  const admin = createSupabaseAdminClient();
  if (!userId) {
    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    userId = typeof userRow?.id === "string" ? userRow.id : undefined;
  }

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "no_user_id", hint: "Passe { user_id } ou crée un compte local." },
      { status: 400 },
    );
  }

  const kinds = Object.keys(SMS_NOTIFICATION_IMPACT_BY_KIND);
  const seeded: string[] = [];

  for (const kind of kinds) {
    trackNotificationSentServer({
      userId,
      kind,
      idempotencyKey: `${DEV_SEED_IDEMPOTENCY_PREFIX}:${kind}`,
      metadata: {
        cart_id: "00000000-0000-4000-8000-000000000001",
        item_id: "00000000-0000-4000-8000-000000000002",
        dev_seed: true,
      },
    });
    seeded.push(kind);
  }

  await flushServerAnalytics();

  return NextResponse.json({
    ok: true,
    user_id: userId,
    event: "notification_sent",
    kinds_seeded: seeded,
    count: seeded.length,
    note: "Events PostHog sans SMS réel. Ré-exécuter met à jour les mêmes insert_id (pas de doublon).",
  });
}
