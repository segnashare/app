"use client";

import Link from "next/link";
import { useState } from "react";

import { SignUpPasswordCore } from "@/components/auth/SignUpPasswordCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

import { Playfair_Display } from "next/font/google";
const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: "800" });

export default function SignUpPasswordPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/auth/sign-up/password"
      nextStep="/onboarding/welcome"
      showStepTracker={false}
      persistProgressOnNext={false}
      fillViewport={false}
      fixedFooterHeight={false}
      layoutCarreSvg={<img src="/ressources/icons/mdp.svg" alt="" className="h-full w-full" />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className="h-full w-full" />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[450px] text-[48px] font-extrabold leading-[0.96] tracking-[-0.03em] text-zinc-950")}>
          Crée ton mot de passe
        </h1>
      }
      mainLayout={<SignUpPasswordCore formId="signup-password-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerCentre={
        <div className={`${themeClassNames.onboarding.shell.footerLigneInfo} ${themeClassNames.onboarding.shell.footerInfoTroisQuarts} text-[16px] text-zinc-950`}>
          <p>
            Tu as déjà un compte ?{" "}
            <br />
            <Link href="/auth/sign-in" className="font-bold text-zinc-950">
              Se connecter
            </Link>
          </p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="signup-password-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider le mot de passe"
    />
  );
}
