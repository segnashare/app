import { redirect } from "next/navigation";

import { OnboardingIntroStepThreeClient } from "@/app/onboarding/3/OnboardingIntroStepThreeClient";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function OnboardingCheckpointThreePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?redirect=%2Fonboarding%2F3");
  }

  const initialCmsFrames = await fetchCmsSectionFramesResolved(supabase, "onboarding_3_intro");

  return <OnboardingIntroStepThreeClient initialCmsFrames={initialCmsFrames} />;
}
