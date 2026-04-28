"use client";

import { useCallback, useState } from "react";

import { OnboardingBirthCore } from "@/components/onboarding/OnboardingBirthCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

const AUTH_BG = "bg-white";

export default function OnboardingBirthPage() {
  const [canContinue, setCanContinue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [footerError, setFooterError] = useState<string | null>(null);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);

  const handleFooterErrorChange = useCallback((message: string | null) => {
    setFooterError(message);
  }, []);

  return (
    <OnboardingScreenShell
      currentStep="/onboarding/birth"
      nextStep="/onboarding/size"
      showStepTracker={true}
      persistProgressOnNext={false}
      centeredAuthLayout
      appViewportFillHeightWideAtMd
      centeredAuthMaxWidthClassName="md:max-w-[min(100%,780px)]"
      appViewportOuterClassName={AUTH_BG}
      appViewportClassName={AUTH_BG}
      centeredAuthSectionGapClassName="gap-y-20 md:gap-y-10"
      centeredAuthBelowHeader={
        <AuthRingDotSpinner
          variant="onLight"
          dotCount={6}
          filledDots={5}
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
            Quelle est ta date de naissance ?
          </h1>
          <p className={cn(montserrat.className, "max-w-[min(100%,340px)] text-[15px] font-bold leading-snug text-[#999999]")}>
            Cela nous permet de calculer l&apos;âge qui s&apos;affiche sur ton profil.
          </p>
        </div>
      }
      mainLayout={
        <OnboardingBirthCore
          formId="onboarding-birth-form"
          formClassName="mx-auto flex w-full flex-col items-center gap-5"
          onCanContinueChange={setCanContinue}
          onSubmittingChange={handleSubmittingChange}
          onFooterErrorChange={handleFooterErrorChange}
        />
      }
      footerRightSlot={
        <div className="flex w-full max-w-[320px] flex-col items-center gap-2">
          <button
            type="submit"
            form="onboarding-birth-form"
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
          {footerError ? (
            <p
              role="alert"
              className={cn(
                montserrat.className,
                themeClassNames.onboarding.textes.erreurFormulaire,
                "w-full max-w-[320px] text-center text-[14px] font-semibold leading-snug",
              )}
            >
              {footerError}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
