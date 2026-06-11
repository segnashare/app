import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { PARIS_CRON_SLOTS, parisCronGuardResponse } from "@/lib/cron/paris-cron-guard";
import { runAbandonedCartReminders } from "@/lib/cron/run-member-engagement-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 18:00 Europe/Paris — SMS panier abandonné (panier ouvert 48 h+).
 * Planifié toutes les 30 min UTC ; garde-fou heure Paris.
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const skipped = parisCronGuardResponse(PARIS_CRON_SLOTS.abandonedCartReminders);
  if (skipped) return skipped;

  const admin = createSupabaseAdminClient();

  try {
    const abandonedCart = await runAbandonedCartReminders(admin);
    return NextResponse.json({ ok: true as const, abandonedCart });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
