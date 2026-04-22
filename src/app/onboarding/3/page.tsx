"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OnboardingIntroCmsStepShell } from "@/components/onboarding/OnboardingIntroCmsStepShell";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function OnboardingCheckpointThreePage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isContinuing, setIsContinuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleContinue = async () => {
    if (isContinuing) return;
    setErrorMessage(null);
    setIsContinuing(true);
    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/privacy",
      p_progress_json: { checkpoint: "/onboarding/3" },
      p_request_id: crypto.randomUUID(),
    });
    setIsContinuing(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.push("/onboarding/privacy");
  };

  return (
    <OnboardingIntroCmsStepShell
      sectionKey="onboarding_3_intro"
      trackerStep="/onboarding/3"
      pillActiveIndex={2}
      isContinuing={isContinuing}
      errorMessage={errorMessage}
      onContinue={handleContinue}
      title={
        <>
          Terminé !{" "}
          <br />
          Voyons ce qui attire ton attention.
        </>
      }
      continueLabel={"Découvrir l'app"}
    />
  );
}
