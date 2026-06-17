"use client";

import { useEffect, useRef } from "react";

import { trackClientEvent } from "@/lib/analytics/track-client";

type Props = {
  step: string;
};

/** Une fois par étape et par onglet : `onboarding_signup_step_reached`. */
export function OnboardingSignupStepTracker({ step }: Props): null {
  const lastStepRef = useRef<string | null>(null);

  useEffect(() => {
    if (!step || lastStepRef.current === step) return;
    lastStepRef.current = step;

    const storageKey = `segna:ph:onboarding-step:${step}`;
    try {
      if (sessionStorage.getItem(storageKey) === "1") return;
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }

    trackClientEvent("onboarding_signup_step_reached", { step });
  }, [step]);

  return null;
}
