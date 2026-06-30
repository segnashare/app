import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { syncCoursierShipmentTracking } from "@/lib/coursier/sync-shipment-tracking";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Polling Coursier `tracking.php` pour les expéditions aller express actives.
 * Planifié toutes les 10 minutes (`vercel.json`).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const result = await syncCoursierShipmentTracking(admin, {});
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
