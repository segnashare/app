import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runDemandMetricsAggregation } from "@/lib/cron/run-exchange-price-recalibration";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Agrégation quotidienne des signaux demande (likes, panier, emprunts). */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const aggregation = await runDemandMetricsAggregation(admin);
    return NextResponse.json({ ok: true as const, aggregation });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
