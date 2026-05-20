import { NextResponse } from "next/server";

import { getCronRouteBearerSecret } from "@/lib/config/env";
import { runBorrowOverdueAccrual } from "@/lib/cron/run-borrow-overdue-accrual";
import { runBorrowReturnReminders } from "@/lib/cron/run-borrow-return-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Rappels d’échéance de retour d’emprunt + alertes retard (e-mail + SMS si `SEGNA_NOTIFY_SMS_ALERTS=1`).
 * Planifier côté hébergeur : `vercel.json` → `crons` (ex. 1×/jour) ou équivalent ; header
 * `Authorization: Bearer` = `SEGNA_CRON_SECRET` ou `CRON_SECRET` (Vercel envoie automatiquement ce dernier).
 *
 * Recommandation : exécution **quotidienne** (J-3, J-1, J-J, puis `overdue_N` après l’échéance).
 * Planifié aussi via `pg_cron` Supabase (migration `schedule_borrow_return_reminders_cron`).
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
    const [reminders, overdue] = await Promise.all([
      runBorrowReturnReminders(admin),
      runBorrowOverdueAccrual(admin),
    ]);
    return NextResponse.json({ ok: true as const, reminders, overdue });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
