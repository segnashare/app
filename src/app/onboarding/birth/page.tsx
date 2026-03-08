"use client";

import { Montserrat } from "next/font/google";
import { useState } from "react";

import { OnboardingBirthCore } from "@/components/onboarding/OnboardingBirthCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { VisibilityToggleEye } from "@/components/onboarding/VisibilityToggleEye";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export default function OnboardingBirthPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/birth"
      nextStep="/onboarding/1"
     
      layoutCarreSvg={
        <img src="/ressources/icons/birth.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />
      }
      layoutBarreLongue={
        <img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />
      }
      h1Principal={<h1 className={themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold}>Quelle est ta date de naissance ?</h1>}
      mainLayout={<OnboardingBirthCore formId="onboarding-birth-form" onCanContinueChange={setCanContinue} />}
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
      nextArrowForm="onboarding-birth-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider la date de naissance"
    />
  );
}
