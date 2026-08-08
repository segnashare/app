import { NextResponse } from "next/server";

import { dispatchReferrerBonusSmsForReferredUser } from "@/lib/referral/referrer-bonus-notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

/**
 * Filleul authentifié : tente d’envoyer au parrain le SMS bonus (idempotent).
 * Appeler après qualification du parrainage (tél. vérifié + onboarding complété), p.ex. fin de `/onboarding/3` ou vérif téléphone.
 * Auth : cookies web ou Bearer mobile (`segnaAppFetch`).
 */
export async function POST(request: Request) {
  const { user, error: userError } = await resolveRequestUserClient(request);
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
