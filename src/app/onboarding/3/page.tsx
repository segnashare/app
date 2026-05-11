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

    const requestId = () => crypto.randomUUID();

    const [audienceResult, personalizationResult, socialFeaturesResult] = await Promise.all([
      supabase.rpc("accept_user_consent", {
        p_consent_type: "audience",
        p_version: "v1",
        p_granted: true,
        p_request_id: requestId(),
      }),
      supabase.rpc("accept_user_consent", {
        p_consent_type: "personalization",
        p_version: "v1",
        p_granted: true,
        p_request_id: requestId(),
      }),
      supabase.rpc("accept_user_consent", {
        p_consent_type: "social_features",
        p_version: "v1",
        p_granted: true,
        p_request_id: requestId(),
      }),
    ]);

    const consentError =
      audienceResult.error ?? personalizationResult.error ?? socialFeaturesResult.error;
    if (consentError) {
      setIsContinuing(false);
      setErrorMessage(consentError.message);
      return;
    }

    const { error } = await supabase.rpc("complete_onboarding", {
      p_answers_json: {},
      p_visibility_json: {},
      p_request_id: crypto.randomUUID(),
    });
    setIsContinuing(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/shop");
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
