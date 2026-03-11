"use client";

import { Montserrat } from "next/font/google";
import { useState } from "react";

import { OnboardingNameCore } from "@/components/onboarding/OnboardingNameCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export default function OnboardingNamePage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/name"
      nextStep="/onboarding/birth"
      microUpperCase={
        <p className={cn(montserrat.className, themeClassNames.onboarding.textes.microUpperCase)}>
          Segna ne procède à aucun contrôle d&apos;identité ou d&apos;antécédents
        </p>
      }
      layoutCarreSvg={<img src="/ressources/icons/name.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold}>Comment t&apos;appelles-tu ?</h1>
      }
      mainLayout={<OnboardingNameCore formId="onboarding-name-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerCentre={
        <div className={cn(themeClassNames.onboarding.shell.footerLigneInfo, themeClassNames.onboarding.shell.footerInfoTroisQuarts)}>
          <p className={cn(montserrat.className, themeClassNames.onboarding.textes.info, "text-[#5E3023]")}>Pourquoi ?</p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-name-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Continuer"
    />
  );
}
