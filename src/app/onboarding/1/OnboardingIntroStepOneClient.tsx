"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OnboardingIntroCmsStepShell } from "@/components/onboarding/OnboardingIntroCmsStepShell";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CmsFrameRow } from "@/lib/cms/cms-types";

type OnboardingIntroStepOneClientProps = {
  initialCmsFrames: CmsFrameRow[];
};

export function OnboardingIntroStepOneClient({ initialCmsFrames }: OnboardingIntroStepOneClientProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isContinuing, setIsContinuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleContinue = async () => {
    if (isContinuing) return;
    setErrorMessage(null);
    setIsContinuing(true);
    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/phone",
      p_progress_json: { checkpoint: "/onboarding/1" },
      p_request_id: crypto.randomUUID(),
    });
    setIsContinuing(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.push("/onboarding/phone");
  };

  return (
    <OnboardingIntroCmsStepShell
      sectionKey="onboarding_1_intro"
      initialCmsFrames={initialCmsFrames}
      trackerStep="/onboarding/1"
      pillActiveIndex={0}
      isContinuing={isContinuing}
      errorMessage={errorMessage}
      onContinue={handleContinue}
      title={
        <>
          Donnes plus de détails
          <br />
          pour une expérience sur-mesure.
        </>
      }
    />
  );
}
