import { NextResponse } from "next/server";

import { getCronRouteBearerSecret } from "@/lib/config/env";
import { dispatchReferrerBonusSmsForReferredUser } from "@/lib/referral/referrer-bonus-notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Secours : envoie les SMS « bonus parrain » manqués (idempotence par `referrals.id`).
 * Planifier avec le même Bearer que les autres crons (`SEGNA_CRON_SECRET` ou `CRON_SECRET` Vercel).
 */
export async function GET(request: Request) {
  const expected = getCronRouteBearerSecret();
  if (!expected) {
    return NextResponse.json({ ok: false as const, error: "cron_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from("users")
    .select("id, referrer_bonus_modal")
    .not("referrer_bonus_modal", "is", null)
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false as const, error: error.message }, { status: 500 });
  }

  let processed = 0;
  for (const row of rows ?? []) {
    const modal = row.referrer_bonus_modal as { referred_user_id?: string } | null;
    const referredId = typeof modal?.referred_user_id === "string" ? modal.referred_user_id : null;
    if (!referredId) continue;
    try {
      await dispatchReferrerBonusSmsForReferredUser(admin, referredId);
      processed += 1;
    } catch (e) {
      console.error("[cron/referral-referrer-sms] row", row.id, e);
    }
  }

  return NextResponse.json({ ok: true as const, scanned: (rows ?? []).length, processed });
}
