import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runBorrowReturnReminders } from "@/lib/cron/run-borrow-return-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Rappels avant échéance emprunt (J-7 / J-3 / J-1 / J-J).
 * Planifié 19h30 Paris (`vercel.json` + pg_cron).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const reminders = await runBorrowReturnReminders(admin);
    return NextResponse.json({ ok: true as const, reminders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
