"use client";

import { Playfair_Display } from "next/font/google";
import { Sparkles } from "lucide-react";
import { useState } from "react";

import { OnboardingStyleCore } from "@/components/onboarding/OnboardingStyleCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { VisibilityToggleEye } from "@/components/onboarding/VisibilityToggleEye";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingStylePage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/style"
      nextStep="/onboarding/brands"
      layoutCarreSvg={
        <img src="/ressources/icons/style.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />
      }
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[560px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Comment décris-tu ton style ?
        </h1>
      }
      mainLayout={<OnboardingStyleCore formId="onboarding-style-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerHaut={
        <div className={themeClassNames.onboarding.shell.footerLigneVisibilite}>
          <VisibilityToggleEye
            section="style"
            defaultVisible
            iconClassName={themeClassNames.onboarding.shell.footerIconeOeil}
            ariaLabel="Visible sur le profil"
          />
          <p className={themeClassNames.onboarding.textes.footerVisibiliteTexteSemiBold}>Visible sur le profil</p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-style-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider le style"
    />
  );
}
