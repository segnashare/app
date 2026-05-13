import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/config/env";
import { runBorrowReturnReminders } from "@/lib/cron/run-borrow-return-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Rappels d’échéance de retour d’emprunt + alertes retard (e-mail + SMS si `SEGNA_NOTIFY_SMS_ALERTS=1`).
 * Planifier côté hébergeur (ex. Vercel Cron) : `GET /api/cron/member-lifecycle-reminders` avec
 * `Authorization: Bearer ${SEGNA_CRON_SECRET}`.
 *
 * Recommandation : exécution **quotidienne** (buckets relatifs à l’échéance : Guest J-3 / J-1 / JJ ;
 * Membre + / X J-7 / J-3 / JJ, puis `overdue_N` jour par jour après l’échéance).
 */
export async function GET(request: Request) {
  const { SEGNA_CRON_SECRET } = getServerEnv();
  const expected = SEGNA_CRON_SECRET?.trim() ?? "";
  if (!expected) {
    return NextResponse.json({ ok: false as const, error: "cron_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  try {
    const summary = await runBorrowReturnReminders(admin);
    return NextResponse.json({ ok: true as const, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
