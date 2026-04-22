"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppViewport } from "@/components/layout/AppViewport";
import {
  OnboardingIntroImageCarousel,
  isLightBackgroundHex,
  normalizeSlideBackgroundHex,
  type OnboardingCarouselVisualState,
} from "@/components/onboarding/OnboardingIntroImageCarousel";
import { OnboardingIntroImageGrid } from "@/components/onboarding/OnboardingIntroImageGrid";
import { OnboardingIntroImageStack } from "@/components/onboarding/OnboardingIntroImageStack";
import { OnboardingProgressPills } from "@/components/onboarding/OnboardingProgressPills";
import { OnboardingStepTracker } from "@/components/onboarding/OnboardingStepTracker";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

/** Même logique que l’écran /auth : évite d’afficher le contenu tant que les visuels CMS ne sont pas prêts. */
const ONBOARDING_INTRO_PRELOAD_TIMEOUT_MS = 12_000;

export type OnboardingIntroSectionKey = "onboarding_1_intro" | "onboarding_2_intro" | "onboarding_3_intro";

export type OnboardingIntroCmsStepShellProps = {
  sectionKey: OnboardingIntroSectionKey;
  trackerStep: string;
  /** Index 0–2 pour les 3 pastilles (aligné sur /onboarding/1 … /3). */
  pillActiveIndex: 0 | 1 | 2;
  title: ReactNode;
  /** Libellé du CTA (défaut : « Continuer »). */
  continueLabel?: string;
  isContinuing: boolean;
  errorMessage: string | null;
  onContinue: () => void | Promise<void>;
};

export function OnboardingIntroCmsStepShell({
  sectionKey,
  trackerStep,
  pillActiveIndex,
  title,
  continueLabel = "Continuer",
  isContinuing,
  errorMessage,
  onContinue,
}: OnboardingIntroCmsStepShellProps) {
  const [frames, setFrames] = useState<CmsFrameRow[]>([]);
  const [visualsReady, setVisualsReady] = useState(false);
  const isGridIntro = sectionKey === "onboarding_2_intro";
  const isCarouselIntro = sectionKey === "onboarding_3_intro";
  const [carouselBgHex, setCarouselBgHex] = useState("#ffffff");

  const sortedStackFrames = useMemo(() => [...frames].sort((a, b) => a.sort_order - b.sort_order), [frames]);

  const applyCarouselVisual = useCallback((state: OnboardingCarouselVisualState) => {
    setCarouselBgHex((prev) => (prev === state.backgroundHex ? prev : state.backgroundHex));
  }, []);

  const carouselSurfaceLight = isCarouselIntro && isLightBackgroundHex(carouselBgHex);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    const supabase = createSupabaseBrowserClient();

    void (async () => {
      const rows = await fetchCmsSectionFramesResolved(supabase, sectionKey);
      const stack = rows.filter((r) => r.frame_type === "onboarding_stack_image");
      if (cancelled) return;
      setFrames(stack);
      if (sectionKey === "onboarding_3_intro" && stack.length > 0) {
        const firstRow = [...stack].sort((a, b) => a.sort_order - b.sort_order)[0];
        setCarouselBgHex(normalizeSlideBackgroundHex(firstRow.payload.slide_background_hex, "#ffffff"));
      }

      const urls = [
        ...new Set(
          stack
            .map((r) => r.payload?.collage_image?.signed_url)
            .filter((u): u is string => typeof u === "string" && u.length > 0),
        ),
      ];

      if (urls.length === 0) {
        setVisualsReady(true);
        return;
      }

      const t0 = performance.now();
      timeoutId = window.setTimeout(() => {
        if (!cancelled) {
          setVisualsReady(true);
          if (process.env.NODE_ENV === "development") {
            console.warn("[onboarding-intro] préchargement visuels — timeout", {
              sectionKey,
              timeoutMs: ONBOARDING_INTRO_PRELOAD_TIMEOUT_MS,
            });
          }
        }
      }, ONBOARDING_INTRO_PRELOAD_TIMEOUT_MS);

      try {
        await Promise.all(
          urls.map(
            (href) =>
              new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = () => resolve();
                img.src = href;
              }),
          ),
        );
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
      }

      if (cancelled) return;
      setVisualsReady(true);
      if (process.env.NODE_ENV === "development") {
        console.info("[onboarding-intro] préchargement visuels terminé", {
          sectionKey,
          imageCount: urls.length,
          ms: Math.round(performance.now() - t0),
        });
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [sectionKey]);

  const showBackgroundStack = !isGridIntro && !isCarouselIntro && frames.length > 0;
  const showBlockingLoader = !visualsReady;

  return (
    <AppViewport
      fillHeight
      fillHeightWideAtMd
      outerClassName={cn(
        isCarouselIntro && !showBlockingLoader ? "min-h-dvh" : "bg-white",
      )}
      outerStyle={isCarouselIntro && !showBlockingLoader ? { backgroundColor: carouselBgHex } : undefined}
      className={cn(
        "flex min-h-0 w-full flex-col justify-start px-0 py-0",
        isCarouselIntro && !showBlockingLoader ? "bg-transparent" : "bg-white",
      )}
    >
      <OnboardingStepTracker currentStep={trackerStep} />

      {showBlockingLoader ? (
        <div
          className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-5 bg-white px-6"
          role="status"
          aria-live="polite"
          aria-label="Chargement des visuels"
        >
          <AuthRingDotSpinner variant="onLight" dotCount={6} filledDots={6} spinning aria-label="Chargement" />
          <p className={cn(montserrat.className, "text-center text-[15px] font-semibold text-zinc-500")}>
            Chargement…
          </p>
        </div>
      ) : null}

      <div
        className={cn(
          showBlockingLoader && "hidden",
          "relative flex min-h-0 min-w-0 flex-1 flex-col",
          isCarouselIntro ? "overflow-x-visible bg-transparent" : "overflow-x-hidden bg-white",
        )}
        aria-hidden={showBlockingLoader}
      >
        {showBackgroundStack ? (
          <div
            className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden bg-transparent px-5 sm:px-7 md:px-10 lg:px-14"
            aria-hidden
          >
            <OnboardingIntroImageStack frames={frames} />
          </div>
        ) : null}

        <div className="relative z-10 flex min-h-[100dvh] min-w-0 flex-1 flex-col bg-transparent pb-8 pt-[max(4.5rem,calc(env(safe-area-inset-top)+1.35rem))]">
          <div
            className={cn(
              montserrat.className,
              themeClassNames.onboarding.introHeroBlurb,
              "relative z-20 mx-auto mt-1 w-full max-w-full shrink-0 px-2 sm:px-3 md:px-5",
              isCarouselIntro &&
                (carouselSurfaceLight
                  ? "text-zinc-950"
                  : "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]"),
            )}
          >
            {title}
          </div>

          {isGridIntro ? (
            <div className="relative z-20 mx-auto flex min-h-0 w-full max-w-[min(100%,440px)] flex-1 flex-col justify-center py-3 sm:py-5">
              <OnboardingIntroImageGrid frames={frames} />
            </div>
          ) : isCarouselIntro ? (
            <div className="relative z-20 mx-auto flex min-h-0 w-full max-w-[min(100%,440px)] flex-1 flex-col py-2">
              <OnboardingIntroImageCarousel frames={frames} onCarouselVisualUpdate={applyCarouselVisual} />
            </div>
          ) : (
            <div className="min-h-0 flex-1" aria-hidden />
          )}

          <div className="relative z-20 mx-auto mt-auto flex w-full max-w-[min(100%,480px)] shrink-0 flex-col items-center gap-4 bg-transparent px-2 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-2 md:px-4">
            <button
              type="button"
              onClick={() => void onContinue()}
              disabled={isContinuing}
              aria-busy={isContinuing}
              className={cn(
                montserrat.className,
                themeClassNames.auth.pillCtaTextSize,
                "flex h-[50px] w-auto shrink-0 items-center justify-center rounded-full px-6 font-bold transition-opacity disabled:cursor-wait disabled:opacity-60 md:h-[52px] md:px-10",
                isCarouselIntro
                  ? carouselSurfaceLight
                    ? "bg-zinc-950 text-white hover:bg-zinc-900"
                    : "bg-white text-zinc-950 hover:bg-zinc-100"
                  : "bg-zinc-950 text-white hover:bg-zinc-900",
              )}
            >
              {continueLabel}
            </button>
            <OnboardingProgressPills
              activeIndex={pillActiveIndex}
              variant={isCarouselIntro && !carouselSurfaceLight ? "onDark" : "default"}
            />
            {errorMessage ? (
              <p className={cn(montserrat.className, "text-center text-[14px] font-semibold text-[#E44D3E]")}>{errorMessage}</p>
            ) : null}
          </div>
        </div>
      </div>
    </AppViewport>
  );
}
