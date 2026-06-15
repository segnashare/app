import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { PARIS_CRON_SLOTS, parisCronGuardResponse } from "@/lib/cron/paris-cron-guard";
import { runDemandMetricsAggregation } from "@/lib/cron/run-exchange-price-recalibration";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** 06:00 Europe/Paris — agrégation quotidienne des signaux demande. */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const skipped = parisCronGuardResponse(PARIS_CRON_SLOTS.economyDemandMetrics);
  if (skipped) return skipped;

  const admin = createSupabaseAdminClient();

  try {
    const aggregation = await runDemandMetricsAggregation(admin);
    return NextResponse.json({ ok: true as const, aggregation });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
