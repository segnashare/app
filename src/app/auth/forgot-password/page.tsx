"use client";

import Link from "next/link";
import { useState } from "react";
import { Playfair_Display } from "next/font/google";

import { ForgotPasswordCore } from "@/components/auth/ForgotPasswordCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export default function ForgotPasswordPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/auth/forgot-password"
      nextStep="/auth/forgot-password"
      showStepTracker={false}
      persistProgressOnNext={false}
      layoutCarreSvg={<img src="/ressources/icons/mail.svg" alt="" className="h-full w-full" />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className="h-full w-full" />}
      h1Principal={
        <h1 className={cn(playfairDisplay.className, "max-w-[450px] text-[48px] font-extrabold leading-[0.96] tracking-[-0.03em] text-zinc-950")}>
          Mot de passe oublié
        </h1>
      }
      mainLayout={<ForgotPasswordCore formId="forgot-password-form" onCanContinueChange={setCanContinue} />}
      footerFrameGaucheLayerCentre={
        <div className={`${themeClassNames.onboarding.shell.footerLigneInfo} ${themeClassNames.onboarding.shell.footerInfoTroisQuarts} text-[16px] text-zinc-950`}>
          <p>
            Retour à la connexion{" "}
            <br />
            <Link href="/auth/sign-in" className="font-bold text-zinc-950">
              Se connecter
            </Link>
          </p>
        </div>
      }
      nextArrowType="submit"
      nextArrowForm="forgot-password-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Envoyer le lien de réinitialisation"
    />
  );
}
