"use client";

import Link from "next/link";
import { Suspense, useCallback, useState } from "react";

import { SignUpVerifyCore, type SignUpVerifyFooterState } from "@/components/auth/SignUpVerifyCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

const AUTH_BG = "bg-white";

export default function SignUpVerifyPage() {
  const [canContinue, setCanContinue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [footerState, setFooterState] = useState<SignUpVerifyFooterState>({
    field: null,
    submit: null,
    status: null,
  });

  const handleFooterStateChange = useCallback((state: SignUpVerifyFooterState) => {
    setFooterState(state);
  }, []);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);

  const footerErrorVisible = Boolean(footerState.field || footerState.submit);
  const footerStatusVisible = Boolean(footerState.status);

  return (
    <OnboardingScreenShell
      currentStep="/auth/sign-up/verify"
      nextStep="/auth/sign-up/password"
      showStepTracker={false}
      persistProgressOnNext={false}
      centeredAuthLayout
      centeredAuthSectionGapClassName="gap-y-20 md:gap-y-10"
      appViewportOuterClassName={AUTH_BG}
      appViewportClassName={AUTH_BG}
      headerAccessoryTopRight={
        <Link
          href="/auth/login"
          className={cn(
            montserrat.className,
            "text-[15px] font-semibold text-[#999999] transition-colors hover:text-zinc-600",
          )}
        >
          Se connecter
        </Link>
      }
      centeredAuthBelowHeader={
        <AuthRingDotSpinner
          variant="onLight"
          dotCount={6}
          filledDots={6}
          spinning={isSubmitting}
          aria-label={isSubmitting ? "Vérification en cours" : undefined}
        />
      }
      h1Principal={
        <div className="mx-auto flex w-full flex-col items-center gap-2 text-center">
          <h1
            className={cn(
              montserrat.className,
              "text-[clamp(1.35rem,5.5vw,1.875rem)] font-bold leading-tight tracking-tight text-black",
            )}
          >
            Nous vous avons envoyé un code de vérification par e-mail
          </h1>
          <p className={cn(montserrat.className, "text-[15px] font-bold leading-snug text-[#999999]")}>
            Saisissez les 8 chiffres reçus par e-mail
          </p>
        </div>
      }
      mainLayout={
        <Suspense fallback={null}>
          <SignUpVerifyCore
            formId="signup-verify-form"
            onCanContinueChange={setCanContinue}
            onSubmittingChange={handleSubmittingChange}
            onFooterStateChange={handleFooterStateChange}
          />
        </Suspense>
      }
      footerRightSlot={
        <div className="flex w-full max-w-[320px] flex-col items-center gap-1.5">
          {footerStatusVisible ? (
            <p className={cn(montserrat.className, "w-full max-w-[320px] text-center text-[14px] font-semibold text-emerald-700")}>
              {footerState.status}
            </p>
          ) : null}
          <button
            type="submit"
            form="signup-verify-form"
            disabled={isSubmitting}
            className={cn(
              montserrat.className,
              themeClassNames.auth.pillCtaTextSize,
              "h-[52px] w-full max-w-[320px] rounded-full font-bold transition-colors",
              canContinue
                ? cn(
                    "bg-black text-white hover:bg-zinc-900",
                    isSubmitting && "cursor-wait opacity-80 hover:bg-black",
                  )
                : "cursor-pointer bg-[#D3D3D3] text-white hover:bg-[#c4c4c4]",
            )}
          >
            Continuer
          </button>
          {footerErrorVisible ? (
            <p
              role="alert"
              className={cn(
                montserrat.className,
                themeClassNames.onboarding.textes.erreurFormulaire,
                "w-full max-w-[320px] text-center text-[14px] font-semibold leading-snug",
              )}
            >
              {footerState.field ? <span>{footerState.field}</span> : null}
              {footerState.field && footerState.submit ? <br /> : null}
              {footerState.submit ? <span>{footerState.submit}</span> : null}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
