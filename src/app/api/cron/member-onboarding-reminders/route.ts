import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { PARIS_CRON_SLOTS, parisCronGuardResponse } from "@/lib/cron/paris-cron-guard";
import { runMemberOnboardingReminders } from "@/lib/cron/run-member-engagement-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 15:00 Europe/Paris — SMS onboarding in-app incomplet.
 * Planifié toutes les 30 min UTC ; garde-fou heure Paris.
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const skipped = parisCronGuardResponse(PARIS_CRON_SLOTS.onboardingReminders);
  if (skipped) return skipped;

  const admin = createSupabaseAdminClient();

  try {
    const result = await runMemberOnboardingReminders(admin);
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
