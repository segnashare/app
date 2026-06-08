import { NextResponse } from "next/server";

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
    try {
      const admin = createSupabaseAdminClient();
      await dispatchReferrerBonusSmsForReferredUser(admin, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[referral/try-qualify-pending] notify", msg);
    }
  }

  return NextResponse.json({ ok: true, ...(payload ?? {}) });
}
