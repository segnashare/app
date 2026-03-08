"use client";

import { Playfair_Display } from "next/font/google";
import { Eye } from "lucide-react";
import { useState } from "react";

import { OnboardingEthicCore } from "@/components/onboarding/OnboardingEthicCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { VisibilityToggleEye } from "@/components/onboarding/VisibilityToggleEye";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingEthicPage() {
  const [canContinue, setCanContinue] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/ethic"
      nextStep="/onboarding/privacy"
      layoutCarreSvg={
        <img src="/ressources/icons/segna.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />
      }
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[560px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Côté éthique, comment te sens-tu ?
        </h1>
      }
      mainLayout={<OnboardingEthicCore formId="onboarding-ethic-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerHaut={
        <div className={themeClassNames.onboarding.shell.footerLigneVisibilite}>
          <VisibilityToggleEye
            section="ethic"
            visible={isVisible}
            onVisibilityChange={setIsVisible}
            iconClassName={themeClassNames.onboarding.shell.footerIconeOeil}
            ariaLabel={isVisible ? "Visible sur le profil" : "Masqué sur le profil"}
          />
          <p className={themeClassNames.onboarding.textes.footerVisibiliteTexteSemiBold}>{isVisible ? "Visible sur le profil" : "Masqué sur le profil"}</p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-ethic-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider l'ethique"
    />
  );
}
