"use client";

import { Playfair_Display } from "next/font/google";
import { useState } from "react";

import { OnboardingBrandsCore } from "@/components/onboarding/OnboardingBrandsCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { VisibilityToggleEye } from "@/components/onboarding/VisibilityToggleEye";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingBrandsPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/brands"
      nextStep="/onboarding/size"
      layoutCarreSvg={<img src="/ressources/icons/brand.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[560px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Quelles marques te font craquer ?
        </h1>
      }
      mainLayout={<OnboardingBrandsCore formId="onboarding-brands-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerHaut={
        <div className={themeClassNames.onboarding.shell.footerLigneVisibilite}>
          <VisibilityToggleEye
            section="brands"
            defaultVisible
            iconClassName={themeClassNames.onboarding.shell.footerIconeOeil}
            ariaLabel="Visible sur le profil"
          />
          <p className={themeClassNames.onboarding.textes.footerVisibiliteTexteSemiBold}>Visible sur le profil</p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-brands-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider les marques"
    />
  );
}
