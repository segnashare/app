"use client";

import { Playfair_Display } from "next/font/google";
import { useState } from "react";

import { OnboardingPrivacyCore } from "@/components/onboarding/OnboardingPrivacyCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingPrivacyPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/privacy"
      nextStep="/onboarding/3"
      layoutCarreSvg={<img src="/ressources/cyber.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Nous respectons ta vie privée
        </h1>
      }
      mainLayout={<OnboardingPrivacyCore formId="onboarding-privacy-form" onCanContinueChange={setCanContinue} />}
      nextArrowType="submit"
      nextArrowForm="onboarding-privacy-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider la confidentialité"
    />
  );
}
