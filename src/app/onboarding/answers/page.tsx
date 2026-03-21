"use client";

import { Playfair_Display } from "next/font/google";
import { Suspense, useState } from "react";

import { OnboardingAnswersCore } from "@/components/onboarding/OnboardingAnswersCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingAnswersPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/answers"
      nextStep="/onboarding/subscription"
      layoutCarreSvg={<img src="/ressources/icons/quote.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[560px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Présente nous ton style
        </h1>
      }
      mainLayout={
        <Suspense fallback={null}>
          <OnboardingAnswersCore formId="onboarding-answers-form" onCanContinueChange={setCanContinue} />
        </Suspense>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-answers-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider les insights"
    />
  );
}
