import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { PARIS_CRON_SLOTS, parisCronGuardResponse } from "@/lib/cron/paris-cron-guard";
import { runBorrowOverdueAccrual } from "@/lib/cron/run-borrow-overdue-accrual";
import { runBorrowReturnReminders } from "@/lib/cron/run-borrow-return-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 10:00 Europe/Paris : rappel J-J + pénalités / alertes retard (J+1…).
 * Planifié toutes les 30 min UTC ; garde-fou heure Paris.
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const skipped = parisCronGuardResponse(PARIS_CRON_SLOTS.borrowOverdueAccrual);
  if (skipped) return skipped;

  const admin = createSupabaseAdminClient();

  try {
    const [jjReminders, overdue] = await Promise.all([
      runBorrowReturnReminders(admin, Date.now(), { phases: "jj" }),
      runBorrowOverdueAccrual(admin),
    ]);
    return NextResponse.json({ ok: true as const, jjReminders, overdue });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
