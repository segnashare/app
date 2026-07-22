import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron/verify-cron-request";
import { runItemChatLifecycle } from "@/lib/item-chat/lifecycle";
import { syncItemChatDiscordInbound } from "@/lib/item-chat/sync-discord";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Sync Discord inbound + prompt utilité (12h) / suppression fil (12h après).
 * Planifié chaque minute (`vercel.json`).
 */
export async function GET(request: Request) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  try {
    const admin = createSupabaseAdminClient();
    const sync = await syncItemChatDiscordInbound(admin);
    const lifecycle = await runItemChatLifecycle(admin);
    return NextResponse.json({ ok: true as const, sync, lifecycle });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
