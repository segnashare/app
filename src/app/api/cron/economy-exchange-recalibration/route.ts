import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { PARIS_CRON_SLOTS, parisCronGuardResponse } from "@/lib/cron/paris-cron-guard";
import { runExchangePriceRecalibration } from "@/lib/cron/run-exchange-price-recalibration";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Lundi 08:00 Europe/Paris — recalibrage hebdomadaire des valeurs d'échange. */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const skipped = parisCronGuardResponse(PARIS_CRON_SLOTS.economyExchangeRecalibration);
  if (skipped) return skipped;

  const admin = createSupabaseAdminClient();

  try {
    const result = await runExchangePriceRecalibration(admin);
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
