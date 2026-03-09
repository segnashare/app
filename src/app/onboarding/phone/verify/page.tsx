"use client";

import { Playfair_Display } from "next/font/google";
import { Suspense, useState } from "react";

import { OnboardingPhoneVerifyCore } from "../../../../components/onboarding/OnboardingPhoneVerifyCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function OnboardingPhoneVerifyPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/phone/verify"
      nextStep="/onboarding/name"
      layoutCarreSvg={<img src="/ressources/icons/phone.svg" alt="" className="h-full w-full" />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className="h-full w-full" />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[420px] text-[48px] font-extrabold leading-[0.96] tracking-[-0.03em] text-zinc-950")}>
          Indique ton code de vérification
        </h1>
      }
      mainLayout={
        <Suspense fallback={null}>
          <OnboardingPhoneVerifyCore formId="onboarding-phone-verify-form" onCanContinueChange={setCanContinue} />
        </Suspense>
      }
      nextArrowType="submit"
      nextArrowForm="onboarding-phone-verify-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Vérifier le code"
    />
  );
}
