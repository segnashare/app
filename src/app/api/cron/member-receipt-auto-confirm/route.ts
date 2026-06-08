import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runMemberReceiptAutoConfirm } from "@/lib/cron/run-member-receipt-auto-confirm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Auto-validation « bonne réception » 24 h après livraison aller.
 * Planifié toutes les heures (`vercel.json` + pg_cron).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const result = await runMemberReceiptAutoConfirm(admin);
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
