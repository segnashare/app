"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppViewport } from "@/components/layout/AppViewport";
import { OnboardingStepTracker } from "@/components/onboarding/OnboardingStepTracker";
import { NextArrow } from "@/components/ui/NextArrow";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type OnboardingScreenShellProps = {
  currentStep?: string;
  nextStep?: string;
  children?: ReactNode;
  microUpperCase?: ReactNode;
  layoutCarreSvg?: ReactNode;
  layoutBarreLongue?: ReactNode;
  h1Principal?: ReactNode;
  mainLayout?: ReactNode;
  footerFrameGaucheLayerHaut?: ReactNode;
  footerFrameGaucheLayerCentre?: ReactNode;
  fillViewport?: boolean;
  fixedFooterHeight?: boolean;
  showStepTracker?: boolean;
  persistProgressOnNext?: boolean;
  nextArrowEnabled?: boolean;
  nextArrowType?: "button" | "submit";
  nextArrowForm?: string;
  nextArrowAriaLabel?: string;
  onNextClick?: () => void;
  showDebugFrames?: boolean;
};

export function OnboardingScreenShell({
  currentStep,
  nextStep,
  children,
  microUpperCase,
  layoutCarreSvg,
  layoutBarreLongue,
  h1Principal,
  mainLayout,
  footerFrameGaucheLayerHaut,
  footerFrameGaucheLayerCentre,
  fillViewport = true,
  fixedFooterHeight = true,
  showStepTracker = true,
  persistProgressOnNext = true,
  nextArrowEnabled,
  nextArrowType = "button",
  nextArrowForm,
  nextArrowAriaLabel = "Continuer",
  onNextClick,
  showDebugFrames = false,
}: OnboardingScreenShellProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isContinuing, setIsContinuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onContinue = async () => {
    if (isContinuing) return;
    if (!nextStep) return;

    if (!persistProgressOnNext || !currentStep) {
      router.push(nextStep);
      return;
    }

    setErrorMessage(null);
    setIsContinuing(true);

    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: nextStep,
      p_progress: { checkpoint: currentStep },
    });

    setIsContinuing(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(nextStep);
  };

  const resolvedNextArrowEnabled = nextArrowEnabled ?? !isContinuing;
  const resolvedNextArrowOnClick = onNextClick ?? (nextArrowType === "button" ? onContinue : undefined);

  return (
    <AppViewport
      className={cn(
        themeClassNames.onboarding.shell.viewportOnboardingStandard,
        showDebugFrames && themeClassNames.onboarding.shell.debugCadreViewport,
      )}
    >
      {showStepTracker && currentStep ? <OnboardingStepTracker currentStep={currentStep} /> : null}

      <header
        className={cn(
          themeClassNames.onboarding.shell.spacerHautOnboarding,
          showDebugFrames && themeClassNames.onboarding.shell.debugCadreSpacer,
        )}
      >
        <div className="h-1/2" aria-hidden />
        <div className="flex h-1/4 items-center justify-center bg-transparent px-[5%]">
          {microUpperCase}
        </div>
        <div className="h-1/3" aria-hidden />
      </header>

      <section className={cn("flex flex-col", fillViewport && "flex-1", showDebugFrames && themeClassNames.onboarding.shell.debugCadreContenu)}>
        {layoutCarreSvg || layoutBarreLongue ? (
          <div className={themeClassNames.onboarding.shell.rangeeIconeEtBarre}>
            <div className={themeClassNames.onboarding.shell.layoutCarreSvg}>{layoutCarreSvg}</div>
            <div className={themeClassNames.onboarding.shell.layoutBarreLongue}>{layoutBarreLongue}</div>
          </div>
        ) : null}
        {h1Principal ? <div className={themeClassNames.onboarding.shell.layoutH1NeufDixieme}>{h1Principal}</div> : null}
        {mainLayout ? (
          <div className={themeClassNames.onboarding.shell.mainLayout}>{mainLayout}</div>
        ) : (
          <div className="flex-1">{children}</div>
        )}
      </section>

      {errorMessage ? <p className={themeClassNames.onboarding.textes.erreurFormulaire}>{errorMessage}</p> : null}

      <div
        className={cn(
          fixedFooterHeight ? themeClassNames.onboarding.shell.footerDeuxFrames : themeClassNames.onboarding.shell.footerDeuxFramesAuto,
          showDebugFrames && themeClassNames.onboarding.shell.debugCadreFooter,
        )}
      >
        <div
          className={cn(
            themeClassNames.onboarding.shell.footerFrameGauche,
            showDebugFrames && themeClassNames.onboarding.shell.debugCadreFooterGauche,
          )}
        >
          <div className={themeClassNames.onboarding.shell.footerFrameGaucheLayerHaut}>{footerFrameGaucheLayerHaut}</div>
          <div className={themeClassNames.onboarding.shell.footerFrameGaucheLayerCentre}>{footerFrameGaucheLayerCentre}</div>
          <div className={themeClassNames.onboarding.shell.footerFrameGaucheLayerBasVide} aria-hidden />
        </div>
        <div
          className={cn(
            themeClassNames.onboarding.shell.footerFrameDroiteFleche,
            showDebugFrames && themeClassNames.onboarding.shell.debugCadreFooterDroite,
          )}
        >
          <NextArrow
            type={nextArrowType}
            form={nextArrowForm}
            onClick={resolvedNextArrowOnClick}
            enabled={resolvedNextArrowEnabled}
            ariaLabel={nextArrowAriaLabel}
          />
        </div>
      </div>
    </AppViewport>
  );
}
