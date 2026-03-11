"use client";

import { Playfair_Display } from "next/font/google";
import { useState } from "react";

import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { OnboardingSizeCore } from "@/components/onboarding/OnboardingSizeCore";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingSizePage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/size"
      nextStep="/onboarding/work"
      layoutCarreSvg={<img src="/ressources/icons/size.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[560px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Quelles sont tes tailles ?
        </h1>
      }
      mainLayout={<OnboardingSizeCore formId="onboarding-size-form" onCanContinueChange={setCanContinue} />}
      nextArrowType="submit"
      nextArrowForm="onboarding-size-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider les tailles"
    />
  );
}
