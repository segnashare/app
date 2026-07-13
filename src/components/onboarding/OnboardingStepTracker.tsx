"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { MEMBER_HOME_HREF } from "@/components/layout/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OnboardingStepTrackerProps = {
  currentStep: string;
};

const ONBOARDING_PATHS = [
  "/onboarding/1",
  "/onboarding/phone",
  "/onboarding/phone/verify",
  "/onboarding/name",
  "/onboarding/2",
  "/onboarding/birth",
  "/onboarding/size",
  "/onboarding/3",
  "/onboarding/end",
] as const;

const LEGACY_PERSISTED_STEP: Record<string, (typeof ONBOARDING_PATHS)[number]> = {
  "/onboarding/privacy": "/onboarding/3",
  "/onboarding/interests": "/onboarding/3",
};

const ONBOARDING_PATH_SET = new Set<string>(ONBOARDING_PATHS);
const FALLBACK_STEP = "/onboarding/1";

function canStayOnStep(currentStep: string, persistedStep: string) {
  if (persistedStep === currentStep) return true;
  return false;
}

export function OnboardingStepTracker({ currentStep }: OnboardingStepTrackerProps) {
  const router = useRouter();

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ONBOARDING_CLIENT_GUARD !== "1") return;

    const guardOnboardingAccess = async () => {
      const supabase = createSupabaseBrowserClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/auth/login");
        return;
      }

      const { data: row } = await supabase
        .from("onboarding_sessions")
        .select("current_step, status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (row?.status === "completed") {
        router.replace(MEMBER_HOME_HREF);
        return;
      }

      const rawStep = typeof row?.current_step === "string" ? row.current_step : "";
      const normalizedStep = LEGACY_PERSISTED_STEP[rawStep] ?? rawStep;
      let persistedStep = ONBOARDING_PATH_SET.has(normalizedStep) ? normalizedStep : FALLBACK_STEP;

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
