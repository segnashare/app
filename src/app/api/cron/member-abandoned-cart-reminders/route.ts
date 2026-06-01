import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runAbandonedCartReminders } from "@/lib/cron/run-member-engagement-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * SMS panier abandonné (panier ouvert 48 h+).
 * Planifié 18h00 Paris (`vercel.json` + pg_cron).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const abandonedCart = await runAbandonedCartReminders(admin);
    return NextResponse.json({ ok: true as const, abandonedCart });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
