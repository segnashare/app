"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ResetPasswordCore, type ResetPasswordFooterState } from "@/components/auth/ResetPasswordCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

const AUTH_BG = "bg-white";

export default function ResetPasswordPage() {
  const [canContinue, setCanContinue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [footerState, setFooterState] = useState<ResetPasswordFooterState>({
    password: null,
    confirmPassword: null,
    general: null,
  });

  const handleFooterStateChange = useCallback((state: ResetPasswordFooterState) => {
    setFooterState(state);
  }, []);

  const footerErrorVisible = Boolean(footerState.password || footerState.confirmPassword || footerState.general);

  return (
    <OnboardingScreenShell
      currentStep="/auth/reset-password"
      nextStep="/auth/login"
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
          aria-label={isSubmitting ? "Mise à jour en cours" : undefined}
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
            Nouveau mot de passe
          </h1>
          <p className={cn(montserrat.className, "text-[15px] font-bold leading-snug text-[#999999]")}>
            Défini un nouveau mot de passe pour ton compte.
          </p>
        </div>
      }
      mainLayout={
        <ResetPasswordCore
          formId="reset-password-form"
          onCanContinueChange={setCanContinue}
          onSubmittingChange={setIsSubmitting}
          onFooterStateChange={handleFooterStateChange}
        />
      }
      footerRightSlot={
        <div className="flex w-full max-w-[320px] flex-col items-center gap-2">
          <button
            type="submit"
            form="reset-password-form"
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
              {footerState.password ? <span>{footerState.password}</span> : null}
              {footerState.password && (footerState.confirmPassword || footerState.general) ? <br /> : null}
              {footerState.confirmPassword ? <span>{footerState.confirmPassword}</span> : null}
              {footerState.confirmPassword && footerState.general ? <br /> : null}
              {footerState.general ? <span>{footerState.general}</span> : null}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
