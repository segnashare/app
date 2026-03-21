"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

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

const ONBOARDING_PATH_SET = new Set<string>(ONBOARDING_PATHS);
const FALLBACK_STEP = "/onboarding/welcome";

function canStayOnStep(currentStep: string, persistedStep: string) {
  if (persistedStep === currentStep) return true;
  if (currentStep === "/onboarding/package" && persistedStep === "/onboarding/subscription") return true;
  if (currentStep === "/onboarding/end" && (persistedStep === "/onboarding/subscription" || persistedStep === "/onboarding/package")) {
    return true;
  }
  return false;
}

export function OnboardingStepTracker({ currentStep }: OnboardingStepTrackerProps) {
  const router = useRouter();

  useEffect(() => {
    const guardOnboardingAccess = async () => {
      const supabase = createSupabaseBrowserClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/auth");
        return;
      }

      const { data: row } = await supabase
        .from("onboarding_sessions")
        .select("current_step, status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (row?.status === "completed") {
        router.replace("/home");
        return;
      }

      let persistedStep =
        typeof row?.current_step === "string" && ONBOARDING_PATH_SET.has(row.current_step) ? row.current_step : FALLBACK_STEP;

      if (!row) {
        await supabase.rpc("upsert_onboarding_progress", {
          p_current_step: FALLBACK_STEP,
          p_progress_json: { checkpoint: FALLBACK_STEP },
          p_request_id: crypto.randomUUID(),
        });
        persistedStep = FALLBACK_STEP;
      }

      if (!canStayOnStep(currentStep, persistedStep)) {
        router.replace(persistedStep);
      }
    };

    void guardOnboardingAccess();
  }, [currentStep, router]);

  return null;
}
