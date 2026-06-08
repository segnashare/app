import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runExchangePriceRecalibration } from "@/lib/cron/run-exchange-price-recalibration";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Recalibrage hebdomadaire des valeurs d'échange (lundi 06:00 UTC). */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const result = await runExchangePriceRecalibration(admin);
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
