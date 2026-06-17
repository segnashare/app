import { NextResponse } from "next/server";

import { activateOnboardingIncludedCredits } from "@/lib/onboarding/activate-included-credits";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { trackOnboardingInAppStepServer } from "@/lib/analytics/track-onboarding-in-app-step-server";
import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
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

    if (!result.alreadyClaimed) {
      trackOnboardingInAppStepServer(user.id, {
        fromStep: "offer",
        toStep: "exchange",
        trigger: "credits_claimed",
      });
      trackServerEvent(
        ANALYTICS_EVENTS.includedCreditsActivated,
        {
          distinctId: user.id,
          insertId: `included_credits:${user.id}`,
        },
        {
          credits_granted: result.creditsGranted,
          included_credits_amount: result.includedCreditsAmount,
          already_claimed: false,
          source: "offer_claim_api",
        },
      );
    }

    await flushServerAnalytics();

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
