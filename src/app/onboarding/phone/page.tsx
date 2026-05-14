"use client";

import { useCallback, useState } from "react";

import {
  OnboardingPhoneCore,
  type OnboardingPhoneAuthErrorState,
} from "@/components/onboarding/OnboardingPhoneCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

const AUTH_BG = "bg-white";

export default function OnboardingPhonePage() {
  const [canContinue, setCanContinue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authErrors, setAuthErrors] = useState<OnboardingPhoneAuthErrorState>({
    field: null,
    submit: null,
  });

  const handleAuthErrorStateChange = useCallback((state: OnboardingPhoneAuthErrorState) => {
    setAuthErrors(state);
  }, []);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);

  const footerErrorVisible = Boolean(authErrors.field || authErrors.submit);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/phone"
      nextStep="/onboarding/phone/verify"
      showStepTracker={true}
      persistProgressOnNext={false}
      centeredAuthLayout
      appViewportOuterClassName={AUTH_BG}
      appViewportClassName={AUTH_BG}
      centeredAuthBelowHeader={
        <AuthRingDotSpinner
          variant="onLight"
          dotCount={6}
          filledDots={3}
          spinning={isSubmitting}
          aria-label={isSubmitting ? "Envoi en cours" : undefined}
        />
      }
      centeredAuthSectionGapClassName="gap-y-[clamp(3.25rem,12vh,6.25rem)]"
      h1Principal={
        <div className="mx-auto flex w-full flex-col items-center gap-2 text-center">
          <h1
            className={cn(
              montserrat.className,
              "text-[clamp(1.35rem,5.5vw,1.875rem)] font-bold leading-tight tracking-tight text-black",
            )}
          >
            Indique ton numéro de téléphone
          </h1>
          <p className={cn(montserrat.className, "max-w-[min(100%,340px)] text-[15px] font-bold leading-snug text-[#999999]")}>
            Nous t&apos;enverrons un code par SMS pour sécuriser ton compte.
          </p>
        </div>
      }
      mainLayout={
        <OnboardingPhoneCore
          formId="onboarding-phone-form"
          onCanContinueChange={setCanContinue}
          onAuthErrorStateChange={handleAuthErrorStateChange}
          onSubmittingChange={handleSubmittingChange}
        />
      }
      footerRightSlot={
        <div className="flex w-full max-w-[320px] flex-col items-center gap-2">
          <button
            type="submit"
            form="onboarding-phone-form"
            disabled={isSubmitting}
            className={cn(
              montserrat.className,
              themeClassNames.auth.pillCtaTextSize,
              "h-[52px] w-full max-w-[320px] rounded-full font-bold transition-colors",
              canContinue
                ? cn("bg-black text-white hover:bg-zinc-900", isSubmitting && "cursor-wait opacity-80 hover:bg-black")
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
              {authErrors.field ? <span>{authErrors.field}</span> : null}
              {authErrors.field && authErrors.submit ? <br /> : null}
              {authErrors.submit ? <span>{authErrors.submit}</span> : null}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
