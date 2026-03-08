"use client";

import { useEffect } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OnboardingStepTrackerProps = {
  currentStep: string;
};

const ONBOARDING_PATHS = [
  "/onboarding/welcome",
  "/onboarding/phone",
  "/onboarding/phone/verify",
  "/onboarding/name",
  "/onboarding/birth",
  "/onboarding/1",
  "/onboarding/location",
  "/onboarding/profile",
  "/onboarding/style",
  "/onboarding/brands",
  "/onboarding/size",
  "/onboarding/work",
  "/onboarding/2",
  "/onboarding/motivation",
  "/onboarding/experience",
  "/onboarding/share",
  "/onboarding/budget",
  "/onboarding/dressing",
  "/onboarding/ethic",
  "/onboarding/privacy",
  "/onboarding/3",
  "/onboarding/looks",
  "/onboarding/answers",
  "/onboarding/subscription",
  "/onboarding/package",
  "/onboarding/end",
] as const;

function getStepIndex(step: string | null | undefined) {
  if (!step) return -1;
  return ONBOARDING_PATHS.findIndex((path) => path === step);
}

export function OnboardingStepTracker({ currentStep }: OnboardingStepTrackerProps) {
  useEffect(() => {
    const syncCurrentStep = async () => {
      const supabase = createSupabaseBrowserClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return;

      const { data: row } = await supabase
        .from("onboarding_sessions")
        .select("current_step, status")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (row?.status === "completed") return;

      const currentIndex = getStepIndex(row?.current_step);
      const targetIndex = getStepIndex(currentStep);
      if (targetIndex === -1) return;

      // Never move backward if a further step is already persisted.
      if (currentIndex >= targetIndex) return;

      await supabase.rpc("save_onboarding_progress", {
        p_current_step: currentStep,
        p_progress: { checkpoint: currentStep },
      });
    };

    void syncCurrentStep();
  }, [currentStep]);

  return null;
}
