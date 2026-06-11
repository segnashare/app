import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { PARIS_CRON_SLOTS, parisCronGuardResponse } from "@/lib/cron/paris-cron-guard";
import { runBorrowReturnReminders } from "@/lib/cron/run-borrow-return-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 19:30 Europe/Paris — rappels avant échéance emprunt (J-7 / J-3 / J-1).
 * Planifié toutes les 30 min UTC ; garde-fou heure Paris.
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const skipped = parisCronGuardResponse(PARIS_CRON_SLOTS.borrowReturnReminders);
  if (skipped) return skipped;

  const admin = createSupabaseAdminClient();

  try {
    const reminders = await runBorrowReturnReminders(admin, Date.now(), { phases: "advance" });
    return NextResponse.json({ ok: true as const, reminders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
