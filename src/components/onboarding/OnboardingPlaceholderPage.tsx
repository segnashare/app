"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppViewport } from "@/components/layout/AppViewport";
import { OnboardingStepTracker } from "@/components/onboarding/OnboardingStepTracker";
import { NextArrow } from "@/components/ui/NextArrow";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OnboardingPlaceholderPageProps = {
  currentStep: string;
  nextStep: string;
};

export function OnboardingPlaceholderPage({
  currentStep,
  nextStep,
}: OnboardingPlaceholderPageProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isContinuing, setIsContinuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onContinue = async () => {
    if (isContinuing) return;
    setErrorMessage(null);
    setIsContinuing(true);

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: nextStep,
      p_progress_json: { checkpoint: currentStep },
      p_request_id: crypto.randomUUID(),
    });

    setIsContinuing(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(nextStep);
  };

  return (
    <AppViewport className="justify-start bg-[#f9f9f8] px-7 py-6 md:px-8 md:py-8">
      <OnboardingStepTracker currentStep={currentStep} />
      <div className="h-[20vh] min-h-[92px] max-h-[180px]" aria-hidden />
      <section className="flex-1" aria-hidden />

      {errorMessage ? <p className="mb-3 text-[18px] text-[#E44D3E]">{errorMessage}</p> : null}

      <div className="mt-auto flex h-[116px] justify-end pb-1">
        <NextArrow onClick={onContinue} enabled={!isContinuing} ariaLabel="Continuer" />
      </div>
    </AppViewport>
  );
}
