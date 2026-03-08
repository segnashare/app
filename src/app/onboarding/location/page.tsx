"use client";

import { Playfair_Display } from "next/font/google";
import { useState } from "react";
import { MapPin } from "lucide-react";

import { OnboardingLocationCore } from "@/components/onboarding/OnboardingLocationCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingLocationPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/location"
      nextStep="/onboarding/profile"
      layoutCarreSvg={
        <img src="/ressources/icons/location.svg" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />
      }
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className={themeClassNames.onboarding.shell.svgRemplitCadre} />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[520px]", themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold)}>
          Où habites-tu?
        </h1>
      }
      mainLayout={<OnboardingLocationCore formId="onboarding-location-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerCentre={
        <div className={cn(themeClassNames.onboarding.shell.footerLigneInfo, themeClassNames.onboarding.shell.footerInfoTroisQuarts)}>
          <p className={cn(themeClassNames.onboarding.textes.accentMarron, "text-[clamp(16px,2.6vw,20px)]")}>Pourquoi l&apos;adresse?</p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-location-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider la localisation"
    />
  );
}
