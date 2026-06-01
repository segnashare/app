import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runMemberOnboardingReminders } from "@/lib/cron/run-member-engagement-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * SMS onboarding in-app incomplet (1er + 2e rappel).
 * Planifié 15h00 Paris (`vercel.json` + pg_cron).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const result = await runMemberOnboardingReminders(admin);
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
