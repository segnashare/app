import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { PARIS_CRON_SLOTS, parisCronGuardResponse } from "@/lib/cron/paris-cron-guard";
import { runBorrowNonRestitutionInvoice } from "@/lib/cron/run-borrow-non-restitution-invoice";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 10:00 Europe/Paris : facture Stripe indemnité non-restitution (post-deadline MED).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const skipped = parisCronGuardResponse(PARIS_CRON_SLOTS.borrowOverdueAccrual);
  if (skipped) return skipped;

  const admin = createSupabaseAdminClient();

  try {
    const nonRestitution = await runBorrowNonRestitutionInvoice(admin);
    return NextResponse.json({ ok: true as const, nonRestitution });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
