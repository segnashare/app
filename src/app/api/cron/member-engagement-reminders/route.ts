import { NextResponse } from "next/server";

import { getCronRouteBearerSecret } from "@/lib/config/env";
import { runMemberEngagementReminders } from "@/lib/cron/run-member-engagement-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Rappels SMS engagement : onboarding in-app, pièces likées dispo, panier abandonné.
 * SMS envoyés seulement si `SEGNA_NOTIFY_SMS_ALERTS=1` (même gate que les rappels emprunt).
 * Planifier quotidiennement (`vercel.json` + pg_cron Supabase).
 */
export async function GET(request: Request) {
  const expected = getCronRouteBearerSecret();
  if (!expected) {
    return NextResponse.json({ ok: false as const, error: "cron_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  try {
    const result = await runMemberEngagementReminders(admin);
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
