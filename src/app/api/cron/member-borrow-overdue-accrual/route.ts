import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runBorrowOverdueAccrual } from "@/lib/cron/run-borrow-overdue-accrual";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Pénalités + alertes retard retour emprunt (J+1…).
 * Planifié 10h00 Paris (`vercel.json` + pg_cron).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const overdue = await runBorrowOverdueAccrual(admin);
    return NextResponse.json({ ok: true as const, overdue });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
