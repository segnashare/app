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
  /** Optional row above the centered micro label (e.g. sign-in link top-right). */
  headerAccessoryTopRight?: ReactNode;
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
  /** When set, replaces the default `NextArrow` in the footer (e.g. pill submit). */
  footerRightSlot?: ReactNode;
  /** Extra classes for the footer right column when `footerRightSlot` is used. */
  footerRightSlotClassName?: string;
  /** Merged onto `AppViewport` outer `<main>` (background, etc.). */
  appViewportOuterClassName?: string;
  /** Merged onto the inner viewport card (overrides shell background when e.g. `bg-white`). */
  appViewportClassName?: string;
  /** Full-height inner column (no phone frame) — pair with `centeredAuthLayout` for light auth UIs. */
  appViewportFillHeight?: boolean;
  /**
   * Colonne `AppViewport` plus large à partir de `md` (voir `fillHeightWideAtMd`).
   * Utile quand le corps dépasse ~430px (ex. date sur une rangée).
   */
  appViewportFillHeightWideAtMd?: boolean;
  /**
   * Minimal auth layout: slim top bar, vertically centered title + body, centered footer CTA.
   * Implies `appViewportFillHeight` on the viewport unless you set it explicitly.
   */
  centeredAuthLayout?: boolean;
  /**
   * Fusionné avec `max-w-[min(100%,380px)]` sur le titre, le corps, l’erreur et le pied en `centeredAuthLayout`.
   * Ex. `md:max-w-[min(100%,640px)]` pour élargir la zone utile au desktop.
   */
  centeredAuthMaxWidthClassName?: string;
  /** Rendu entre le header (ex. lien) et le bloc titre — ex. indicateur décoratif centré. */
  centeredAuthBelowHeader?: ReactNode;
  /**
   * Espacement vertical en `centeredAuthLayout` : avec `footerRightSlot`, entre le bloc fixe
   * (indicateur + titre) et la zone scrollable ; sinon entre titre, corps et pied dans la même colonne.
   */
  centeredAuthSectionGapClassName?: string;
};

export function OnboardingScreenShell({
  currentStep,
  nextStep,
  children,
  headerAccessoryTopRight,
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
  footerRightSlot,
  footerRightSlotClassName,
  appViewportOuterClassName,
  appViewportClassName,
  appViewportFillHeight = false,
  appViewportFillHeightWideAtMd = false,
  centeredAuthLayout = false,
  centeredAuthBelowHeader,
  centeredAuthSectionGapClassName,
  centeredAuthMaxWidthClassName,
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

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: nextStep,
      p_progress_json: { checkpoint: currentStep },
      p_request_id: crypto.randomUUID(),
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

  const resolvedFillHeight = centeredAuthLayout || appViewportFillHeight;
  const centeredAuthColumnMax = cn("w-full max-w-[min(100%,380px)]", centeredAuthMaxWidthClassName);

  return (
    <AppViewport
      fillHeight={resolvedFillHeight}
      fillHeightWideAtMd={resolvedFillHeight && appViewportFillHeightWideAtMd}
      outerClassName={appViewportOuterClassName}
      className={cn(
        !resolvedFillHeight && themeClassNames.onboarding.shell.viewportOnboardingStandard,
        showDebugFrames && themeClassNames.onboarding.shell.debugCadreViewport,
        centeredAuthLayout &&
          "justify-between px-6 pt-4 pb-0 md:px-8 md:pt-5 md:pb-0",
        appViewportClassName,
      )}
    >
      {showStepTracker && currentStep ? <OnboardingStepTracker currentStep={currentStep} /> : null}

      {centeredAuthLayout ? (
        <>
          <header
            className={cn(
              "flex w-full shrink-0 justify-end pb-12 pt-[max(0.65rem,env(safe-area-inset-top))]",
              showDebugFrames && themeClassNames.onboarding.shell.debugCadreSpacer,
            )}
          >
            {headerAccessoryTopRight}
          </header>

          {footerRightSlot ? null : centeredAuthBelowHeader ? (
            <div className="flex w-full shrink-0 justify-center py-3">{centeredAuthBelowHeader}</div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col">
            {footerRightSlot ? (
              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col",
                  centeredAuthBelowHeader
                    ? cn(centeredAuthSectionGapClassName ?? "gap-y-[clamp(1.5rem,4vh,2.75rem)]")
                    : "gap-y-8 pt-6",
                )}
              >
                <div className="flex w-full shrink-0 flex-col items-center">
                  {centeredAuthBelowHeader ? (
                    <div className="flex w-full justify-center py-3">{centeredAuthBelowHeader}</div>
                  ) : null}
                  {h1Principal ? (
                    <div className={cn(centeredAuthColumnMax, "w-full shrink-0 pt-4")}>{h1Principal}</div>
                  ) : null}
                </div>
                <section
                  className={cn(
                    "flex min-h-0 flex-1 flex-col items-center justify-start gap-3 overflow-y-auto px-0 pb-3",
                    showDebugFrames && themeClassNames.onboarding.shell.debugCadreContenu,
                  )}
                >
                  {mainLayout ? <div className={cn(centeredAuthColumnMax, "shrink-0")}>{mainLayout}</div> : <div className="flex-1">{children}</div>}
                  {errorMessage ? (
                    <p className={cn(themeClassNames.onboarding.textes.erreurFormulaire, centeredAuthColumnMax, "shrink-0 px-2 text-center")}>
                      {errorMessage}
                    </p>
                  ) : null}
                </section>
              </div>
            ) : (
              <section
                className={cn(
                  "flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-0",
                  "pb-[max(1rem,calc(0.75rem+env(safe-area-inset-bottom,0px)))]",
                  centeredAuthBelowHeader
                    ? cn(
                        "justify-start pt-4",
                        centeredAuthSectionGapClassName ?? "gap-y-[clamp(1.5rem,4vh,2.75rem)]",
                      )
                    : "justify-center gap-8 pt-10 -translate-y-[min(10vh,88px)] md:-translate-y-[min(12vh,104px)]",
                  showDebugFrames && themeClassNames.onboarding.shell.debugCadreContenu,
                )}
              >
                {h1Principal ? <div className={cn(centeredAuthColumnMax, "shrink-0")}>{h1Principal}</div> : null}
                {mainLayout ? <div className={cn(centeredAuthColumnMax, "shrink-0")}>{mainLayout}</div> : <div className="flex-1">{children}</div>}
                {errorMessage ? (
                  <p className={cn(themeClassNames.onboarding.textes.erreurFormulaire, centeredAuthColumnMax, "shrink-0 px-2 text-center")}>
                    {errorMessage}
                  </p>
                ) : null}
              </section>
            )}

            {footerRightSlot ? (
              <div
                className={cn(
                  "flex w-full shrink-0 flex-col items-center gap-2 pt-2",
                  centeredAuthColumnMax,
                  footerRightSlotClassName,
                  "pb-[max(1.25rem,calc(0.75rem+env(safe-area-inset-bottom,0px)))] md:pb-[max(1.75rem,calc(1rem+env(safe-area-inset-bottom,0px)))]",
                  showDebugFrames && themeClassNames.onboarding.shell.debugCadreFooter,
                )}
              >
                {footerRightSlot}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <header
            className={cn(
              themeClassNames.onboarding.shell.spacerHautOnboarding,
              showDebugFrames && themeClassNames.onboarding.shell.debugCadreSpacer,
            )}
          >
            {headerAccessoryTopRight ? (
              <div className="flex w-full shrink-0 justify-end px-[5%] pb-1 pt-0">{headerAccessoryTopRight}</div>
            ) : null}
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
                footerRightSlot
                  ? cn("flex min-h-0 min-w-0 shrink-0 flex-col items-end justify-end pb-1", footerRightSlotClassName)
                  : themeClassNames.onboarding.shell.footerFrameDroiteFleche,
                showDebugFrames && themeClassNames.onboarding.shell.debugCadreFooterDroite,
              )}
            >
              {footerRightSlot ?? (
                <NextArrow
                  type={nextArrowType}
                  form={nextArrowForm}
                  onClick={resolvedNextArrowOnClick}
                  enabled={resolvedNextArrowEnabled}
                  ariaLabel={nextArrowAriaLabel}
                />
              )}
            </div>
          </div>
        </>
      )}
    </AppViewport>
  );
}
