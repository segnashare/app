"use client";

import { Playfair_Display } from "next/font/google";
import { BriefcaseBusiness } from "lucide-react";
import { useState } from "react";

import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { OnboardingWorkCore } from "@/components/onboarding/OnboardingWorkCore";
import { VisibilityToggleEye } from "@/components/onboarding/VisibilityToggleEye";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingWorkPage() {
  const [canContinue, setCanContinue] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/work"
      nextStep="/onboarding/2"
      layoutCarreSvg={<img src="/ressources/icons/work.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[560px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Qu&apos;est-ce que tu fais dans la vie ?
        </h1>
      }
      mainLayout={<OnboardingWorkCore formId="onboarding-work-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerHaut={
        <div className={themeClassNames.onboarding.shell.footerLigneVisibilite}>
          <VisibilityToggleEye
            section="experience"
            visible={isVisible}
            onVisibilityChange={setIsVisible}
            iconClassName={themeClassNames.onboarding.shell.footerIconeOeil}
            ariaLabel={isVisible ? "Visible sur le profil" : "Masqué sur le profil"}
          />
          <p className={themeClassNames.onboarding.textes.footerVisibiliteTexteSemiBold}>{isVisible ? "Visible sur le profil" : "Masqué sur le profil"}</p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-work-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider la profession"
    />
  );
}
