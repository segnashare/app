import { NextResponse } from "next/server";

import { activateOnboardingIncludedCredits } from "@/lib/onboarding/activate-included-credits";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = (await createSupabaseServerClient()) as any;
    const admin = createSupabaseAdminClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const result = await activateOnboardingIncludedCredits(admin, user.id);

    return NextResponse.json({
      ok: true,
      alreadyClaimed: result.alreadyClaimed,
      creditsAdded: result.creditsGranted,
      includedCreditsAmount: result.includedCreditsAmount,
      monthlyIncludedCredits: result.includedCreditsAmount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible d’activer tes crédits inclus.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
