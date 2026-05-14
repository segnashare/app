import { NextResponse } from "next/server";

import { dispatchReferrerBonusSmsForReferredUser } from "@/lib/referral/referrer-bonus-notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Filleul authentifié : tente d’envoyer au parrain le SMS bonus (idempotent).
 * Appeler après qualification du parrainage (tél. vérifié + onboarding complété), p.ex. fin de `/onboarding/3` ou vérif téléphone.
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

  try {
    const admin = createSupabaseAdminClient();
    await dispatchReferrerBonusSmsForReferredUser(admin, user.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[referral/dispatch-referrer-notify]", msg);
  }

  return NextResponse.json({ ok: true });
}
