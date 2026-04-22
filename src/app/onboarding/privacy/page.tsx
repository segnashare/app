"use client";

import { useState } from "react";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const playfairDisplay = segnaPlayfairDisplay;

import { OnboardingPrivacyCore } from "@/components/onboarding/OnboardingPrivacyCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";



export default function OnboardingPrivacyPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/privacy"
      nextStep="/onboarding/end"
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
