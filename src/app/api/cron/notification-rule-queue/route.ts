import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { processNotificationRuleQueue } from "@/lib/notifications/notification-rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * File d’attente des règles BO (délais / conditions).
 * Planifié chaque minute (`vercel.json`).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  const admin = createSupabaseAdminClient();

  try {
    const result = await processNotificationRuleQueue(admin);
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
