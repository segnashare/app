import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { PARIS_CRON_SLOTS, parisCronGuardResponse } from "@/lib/cron/paris-cron-guard";
import { runBorrowFormalNotice } from "@/lib/cron/run-borrow-formal-notice";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 10:00 Europe/Paris : mise en demeure AR24 (J+21+).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const skipped = parisCronGuardResponse(PARIS_CRON_SLOTS.borrowOverdueAccrual);
  if (skipped) return skipped;

  const admin = createSupabaseAdminClient();

  try {
    const formalNotice = await runBorrowFormalNotice(admin);
    return NextResponse.json({ ok: true as const, formalNotice });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
