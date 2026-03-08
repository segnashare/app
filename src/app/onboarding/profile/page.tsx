"use client";

import { Playfair_Display } from "next/font/google";
import { useState } from "react";

import { OnboardingProfileCore } from "@/components/onboarding/OnboardingProfileCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingProfilePage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/profile"
      nextStep="/onboarding/style"
      layoutCarreSvg={
        <img src="/ressources/icons/pdp.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />
      }
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[400px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Montre-nous qui tu es
        </h1>
      }
      mainLayout={<OnboardingProfileCore formId="onboarding-profile-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerCentre={
        <div className={cn(themeClassNames.onboarding.shell.footerLigneInfo, themeClassNames.onboarding.shell.footerInfoTroisQuarts)}>
          <p className={cn(themeClassNames.onboarding.textes.accentMarron, "text-[clamp(16px,2.6vw,20px)]")}>Pourquoi la photo ?</p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-profile-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider la photo de profil"
    />
  );
}
