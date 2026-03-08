"use client";

import { Playfair_Display } from "next/font/google";
import { Camera, Plus } from "lucide-react";
import { useState } from "react";

import { OnboardingLooksCore } from "@/components/onboarding/OnboardingLooksCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingLooksPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/looks"
      nextStep="/onboarding/answers"
      layoutCarreSvg={
        <img src="/ressources/icons/pdp.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />
      }
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[560px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Choisis tes looks préférés
        </h1>
      }
      mainLayout={<OnboardingLooksCore formId="onboarding-looks-form" onCanContinueChange={setCanContinue} />}
      nextArrowType="submit"
      nextArrowForm="onboarding-looks-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider les looks"
    />
  );
}
