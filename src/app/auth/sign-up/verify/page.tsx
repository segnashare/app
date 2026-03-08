"use client";

import Link from "next/link";
import { useState } from "react";

import { SignUpVerifyCore } from "@/components/auth/SignUpVerifyCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { themeClassNames } from "@/styles/theme";

export default function SignUpVerifyPage() {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <OnboardingScreenShell
      currentStep="/auth/sign-up/verify"
      nextStep="/auth/sign-up/password"
      showStepTracker={false}
      persistProgressOnNext={false}
      layoutCarreSvg={<img src="/ressources/icons/mail.svg" alt="" className="h-full w-full" />}
      layoutBarreLongue={<img src="/ressources/barres/barre_signup.png" alt="" className="h-full w-full" />}
      h1Principal={
        <h1 className={`${themeClassNames.onboarding.textes.h1PlayfairDisplayExtraBold} max-w-[420px]`}>
          Nous t&apos;avons envoyé un code de vérification par e-mail
        </h1>
      }
      mainLayout={<SignUpVerifyCore formId="signup-verify-form" onCanContinueChange={setCanContinue} />}
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
      nextArrowForm="signup-verify-form"
      nextArrowEnabled={canContinue}
      nextArrowAriaLabel="Vérifier le code"
    />
  );
}
