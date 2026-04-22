"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OnboardingIntroCmsStepShell } from "@/components/onboarding/OnboardingIntroCmsStepShell";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function OnboardingCheckpointTwoPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isContinuing, setIsContinuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleContinue = async () => {
    if (isContinuing) return;
    setErrorMessage(null);
    setIsContinuing(true);
    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/birth",
      p_progress_json: { checkpoint: "/onboarding/2" },
      p_request_id: crypto.randomUUID(),
    });
    setIsContinuing(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.push("/onboarding/birth");
  };

  return (
    <OnboardingIntroCmsStepShell
      sectionKey="onboarding_2_intro"
      trackerStep="/onboarding/2"
      pillActiveIndex={1}
      isContinuing={isContinuing}
      errorMessage={errorMessage}
      onContinue={handleContinue}
      title={
        <>
          Les bases sont là.
          <br />
          Place à ce qui fera de toi une membre à part.
        </>
      }
    />
  );
}
