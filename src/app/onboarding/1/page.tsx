import { redirect } from "next/navigation";

import { OnboardingIntroStepOneClient } from "@/app/onboarding/1/OnboardingIntroStepOneClient";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function OnboardingCheckpointOnePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?redirect=%2Fonboarding%2F1");
  }

  const initialCmsFrames = await fetchCmsSectionFramesResolved(supabase, "onboarding_1_intro");

  return <OnboardingIntroStepOneClient initialCmsFrames={initialCmsFrames} />;
}
