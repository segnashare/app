"use client";

import { Playfair_Display } from "next/font/google";
import { useState } from "react";

import { OnboardingPhoneCore } from "@/components/onboarding/OnboardingPhoneCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingPhonePage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/phone"
      nextStep="/onboarding/phone/verify"
      layoutCarreSvg={<img src="/ressources/icons/phone.svg" alt="" className="h-full w-full" />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className="h-full w-full" />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[450px] text-[48px] font-extrabold leading-[0.96] tracking-[-0.03em] text-zinc-950")}>
          Indique ton numéro
        </h1>
      }
      mainLayout={<OnboardingPhoneCore formId="onboarding-phone-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerCentre={
        <div className={themeClassNames.onboarding.shell.footerLigneInfo}>
          <p className="text-[clamp(14px,2.6vw,18px)] font-semibold text-[#5E3023]">Que faire si mon numéro change ?</p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-phone-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider le numéro de téléphone"
    />
  );
}
