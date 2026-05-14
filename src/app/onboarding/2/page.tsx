import { redirect } from "next/navigation";

import { OnboardingIntroStepTwoClient } from "@/app/onboarding/2/OnboardingIntroStepTwoClient";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function OnboardingCheckpointTwoPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?redirect=%2Fonboarding%2F2");
  }

  const initialCmsFrames = await fetchCmsSectionFramesResolved(supabase, "onboarding_2_intro");

  return <OnboardingIntroStepTwoClient initialCmsFrames={initialCmsFrames} />;
}
