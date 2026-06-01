import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runMemberEngagementReminders } from "@/lib/cron/run-member-engagement-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Legacy : onboarding + panier abandonné en un appel (tests manuels).
 * En prod, préférer les routes séparées planifiées dans `vercel.json`.
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const result = await runMemberEngagementReminders(admin);
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
