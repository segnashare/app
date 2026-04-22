"use client";

import { useCallback, useState } from "react";

import { OnboardingNameCore } from "@/components/onboarding/OnboardingNameCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

const AUTH_BG = "bg-white";

export default function OnboardingNamePage() {
  const [canContinue, setCanContinue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/name"
      nextStep="/onboarding/2"
      showStepTracker={true}
      persistProgressOnNext={false}
      centeredAuthLayout
      headerAccessoryTopRight={
        <span className={cn(montserrat.className, "text-[15px] font-semibold text-[#999999]")}>Pourquoi ?</span>
      }
      appViewportOuterClassName={AUTH_BG}
      appViewportClassName={AUTH_BG}
      centeredAuthSectionGapClassName="gap-y-20 md:gap-y-10"
      centeredAuthBelowHeader={
        <AuthRingDotSpinner
          variant="onLight"
          dotCount={6}
          filledDots={4}
          spinning={isSubmitting}
          aria-label={isSubmitting ? "Enregistrement en cours" : undefined}
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
            Comment t&apos;appelles-tu ?
          </h1>
          <p
            className={cn(
              montserrat.className,
              "max-w-[min(100%,340px)] text-[11px] font-semibold uppercase leading-snug tracking-wide text-[#999999]",
            )}
          >
            Segna ne procède à aucun contrôle d&apos;identité ou d&apos;antécédents
          </p>
        </div>
      }
      mainLayout={
        <OnboardingNameCore
          formId="onboarding-name-form"
          formClassName="mx-auto flex w-full max-w-[min(100%,380px)] flex-col items-center gap-3 md:gap-4"
          onCanContinueChange={setCanContinue}
          onSubmittingChange={handleSubmittingChange}
        />
      }
      footerRightSlot={
        <div className="flex w-full max-w-[320px] flex-col items-center gap-2">
          <button
            type="submit"
            form="onboarding-name-form"
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
        </div>
      }
    />
  );
}
