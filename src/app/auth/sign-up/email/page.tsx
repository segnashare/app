"use client";

import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import { useState } from "react";

import { SignUpEmailCore } from "@/components/auth/SignUpEmailCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function SignUpEmailPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/auth/sign-up/email"
      nextStep="/auth/sign-up/verify"
      showStepTracker={false}
      persistProgressOnNext={false}
      layoutCarreSvg={<img src="/ressources/icons/mail.svg" alt="" className="h-full w-full" />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className="h-full w-full" />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[450px] text-[48px] font-extrabold leading-[0.96] tracking-[-0.03em] text-zinc-950")}>
          Indique ton adresse e-mail
        </h1>
      }
      mainLayout={<SignUpEmailCore formId="signup-email-form" onCanContinueChange={setCanContinue} />}
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
      nextArrowForm="signup-email-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Valider l'adresse e-mail"
    />
  );
}
