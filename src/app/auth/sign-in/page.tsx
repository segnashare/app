"use client";

import Link from "next/link";
import { useState } from "react";
import { Playfair_Display } from "next/font/google";

import { SignInCore } from "@/components/auth/SignInCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function SignInPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/auth/sign-in"
      nextStep="/onboarding/welcome"
      showStepTracker={false}
      persistProgressOnNext={false}
      layoutCarreSvg={<img src="/ressources/icons/key.svg" alt="" className="h-full w-full" />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className="h-full w-full" />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[450px] text-[48px] font-extrabold leading-[0.96] tracking-[-0.03em] text-zinc-950")}>
          Se connecter
        </h1>
      }
      mainLayout={<SignInCore formId="signin-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerCentre={
        <div className={`${themeClassNames.onboarding.shell.footerLigneInfo} ${themeClassNames.onboarding.shell.footerInfoTroisQuarts} text-[16px] text-zinc-950`}>
          <p>
            Pas encore de compte ?{" "}
            <br />
            <Link href="/auth/sign-up/email" className="font-bold text-zinc-950">
              S&apos;inscrire
            </Link>
          </p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="signin-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Se connecter"
    />
  );
}
