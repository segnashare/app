import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runBorrowOverdueAccrual } from "@/lib/cron/run-borrow-overdue-accrual";
import { runBorrowReturnReminders } from "@/lib/cron/run-borrow-return-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Matin (10h Paris) : rappel J-J + pénalités / alertes retard (J+1…).
 * Planifié via `vercel.json` + pg_cron.
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

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
