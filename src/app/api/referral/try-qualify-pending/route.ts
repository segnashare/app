import { NextResponse } from "next/server";

import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
import { dispatchReferrerBonusSmsForReferredUser } from "@/lib/referral/referrer-bonus-notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Filleul authentifié : tente `qualify_pending_referral` (idempotent).
 * À appeler dès que tél. vérifié + onboarding complété (intro in-app, fin onboarding, etc.).
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("qualify_pending_referral", {
    p_request_id: crypto.randomUUID(),
  });

  if (error) {
    console.error("[referral/try-qualify-pending]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const payload = data as Record<string, unknown> | null;
  const qualified = payload?.qualified === true;

  if (qualified) {
    trackServerEvent(
      ANALYTICS_EVENTS.referralQualified,
      {
        distinctId: user.id,
        insertId: `referral_qualified:${user.id}:${String(payload?.referral_id ?? "unknown")}`,
      },
      {
        referral_id: typeof payload?.referral_id === "string" ? payload.referral_id : undefined,
        referrer_user_id:
          typeof payload?.referrer_user_id === "string" ? payload.referrer_user_id : undefined,
        referred_user_id: user.id,
        trigger: "try_qualify_pending_api",
      },
    );
    try {
      const admin = createSupabaseAdminClient();
      await dispatchReferrerBonusSmsForReferredUser(admin, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[referral/try-qualify-pending] notify", msg);
    }
  }

  await flushServerAnalytics();

  return NextResponse.json({ ok: true, ...(payload ?? {}) });
}
