"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import { AppViewport } from "@/components/layout/AppViewport";
import { AppPageLoading } from "@/components/ui/AppPageLoading";
import {
  isLightBackgroundHex,
  normalizeSlideBackgroundHex,
  type OnboardingCarouselVisualState,
} from "@/components/onboarding/onboarding-intro-carousel-visual";
import { OnboardingIntroImageGrid } from "@/components/onboarding/OnboardingIntroImageGrid";
import { OnboardingIntroImageStack } from "@/components/onboarding/OnboardingIntroImageStack";
import { OnboardingProgressPills } from "@/components/onboarding/OnboardingProgressPills";
import { OnboardingStepTracker } from "@/components/onboarding/OnboardingStepTracker";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { preloadRemoteImages } from "@/lib/ui/preload-remote-images";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;
const OnboardingIntroImageCarousel = dynamic(
  () => import("@/components/onboarding/OnboardingIntroImageCarousel").then((m) => m.OnboardingIntroImageCarousel),
  { ssr: false },
);

/** Timeout de secours si le réseau bloque (log dev uniquement). */
const ONBOARDING_INTRO_PRELOAD_TIMEOUT_MS = 12_000;

export type OnboardingIntroSectionKey = "onboarding_1_intro" | "onboarding_2_intro" | "onboarding_3_intro";

export type OnboardingIntroCmsStepShellProps = {
  sectionKey: OnboardingIntroSectionKey;
  /** Frames CMS déjà résolues côté serveur (URLs signées) — évite un aller-retour + effondrement de layout. */
  initialCmsFrames?: CmsFrameRow[];
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

function stackRowsFromSectionRows(rows: CmsFrameRow[]): CmsFrameRow[] {
  return rows.filter((r) => r.frame_type === "onboarding_stack_image");
}

function collageSignedUrlsFromStack(stack: CmsFrameRow[]): string[] {
  return [
    ...new Set(
      stack
        .map((r) => r.payload?.collage_image?.signed_url)
        .filter((u): u is string => typeof u === "string" && u.length > 0),
    ),
  ];
}

function initialCarouselBgHex(sectionKey: OnboardingIntroSectionKey, rows: CmsFrameRow[] | undefined): string {
  if (sectionKey !== "onboarding_3_intro" || rows === undefined) return "#ffffff";
  const stack = stackRowsFromSectionRows(rows);
  if (stack.length === 0) return "#ffffff";
  const firstRow = [...stack].sort((a, b) => a.sort_order - b.sort_order)[0];
  return normalizeSlideBackgroundHex(firstRow.payload.slide_background_hex, "#ffffff");
}

/** Hauteur de secours si les frames CMS manquent (évite flex-1 à 0 + CTA collé en bas). */
const STACK_VISUAL_MIN_H = "min-h-[min(48dvh,440px)]";
const CAROUSEL_VISUAL_MIN_H = "min-h-[min(36dvh,280px)]";

export function OnboardingIntroCmsStepShell({
  sectionKey,
  initialCmsFrames,
  trackerStep,
  pillActiveIndex,
  title,
  continueLabel = "Continuer",
  isContinuing,
  errorMessage,
  onContinue,
}: OnboardingIntroCmsStepShellProps) {
  const initialStackFrames = useMemo(
    () => (initialCmsFrames !== undefined ? stackRowsFromSectionRows(initialCmsFrames) : []),
    [initialCmsFrames],
  );
  const initialCollageUrls = useMemo(() => collageSignedUrlsFromStack(initialStackFrames), [initialStackFrames]);

  const [frames, setFrames] = useState<CmsFrameRow[]>(() =>
    initialCmsFrames !== undefined && initialCollageUrls.length === 0 ? initialStackFrames : [],
  );
  const [introVisualsReady, setIntroVisualsReady] = useState(
    () => initialCmsFrames !== undefined && initialCollageUrls.length === 0,
  );
  const isGridIntro = sectionKey === "onboarding_2_intro";
  const isCarouselIntro = sectionKey === "onboarding_3_intro";
  const isStackIntro = !isGridIntro && !isCarouselIntro;
  const [carouselBgHex, setCarouselBgHex] = useState(() => initialCarouselBgHex(sectionKey, initialCmsFrames));

  const applyCarouselVisual = useCallback((state: OnboardingCarouselVisualState) => {
    setCarouselBgHex((prev) => (prev === state.backgroundHex ? prev : state.backgroundHex));
  }, []);

  const carouselSurfaceLight = isCarouselIntro && isLightBackgroundHex(carouselBgHex);
  const showCarouselChrome = isCarouselIntro && frames.length > 0;

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();

    void (async () => {
      let rows: CmsFrameRow[];
      if (initialCmsFrames !== undefined) {
        rows = initialCmsFrames;
      } else {
        rows = await fetchCmsSectionFramesResolved(supabase, sectionKey);
      }
      if (cancelled) return;

      const stack = stackRowsFromSectionRows(rows);

      if (sectionKey === "onboarding_3_intro" && stack.length > 0) {
        const firstRow = [...stack].sort((a, b) => a.sort_order - b.sort_order)[0];
        setCarouselBgHex(normalizeSlideBackgroundHex(firstRow.payload.slide_background_hex, "#ffffff"));
      }

      const urls = collageSignedUrlsFromStack(stack);
      if (urls.length > 0) {
        try {
          await preloadRemoteImages(urls, { timeoutMs: ONBOARDING_INTRO_PRELOAD_TIMEOUT_MS });
        } catch {
          /* ignore — afficher la page même si le réseau bloque */
        }
      }

      if (cancelled) return;
      setFrames(stack);
      setIntroVisualsReady(true);

      if (process.env.NODE_ENV === "development" && urls.length > 0) {
        console.info("[onboarding-intro] préchargement visuels terminé", {
          sectionKey,
          imageCount: urls.length,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sectionKey, initialCmsFrames]);

  const stackVisualShellClass =
    "relative z-20 mx-auto flex min-h-0 w-full max-w-[min(100%,440px)] flex-1 flex-col items-center justify-center px-5 py-[clamp(1.5rem,5dvh,3rem)] sm:px-7 md:max-w-[min(100%,760px)] md:px-10 lg:px-14";

  if (!introVisualsReady) {
    return <AppPageLoading label="Chargement" />;
  }

  return (
    <AppViewport
      fillHeight
      fillHeightWideAtMd
      outerClassName={cn(showCarouselChrome ? "min-h-dvh" : "bg-white")}
      outerStyle={showCarouselChrome ? { backgroundColor: carouselBgHex } : undefined}
      className={cn(
        "flex min-h-0 w-full flex-col justify-start px-0 py-0",
        showCarouselChrome ? "bg-transparent" : "bg-white",
      )}
    >
      <OnboardingStepTracker currentStep={trackerStep} />

      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col",
          isCarouselIntro ? "overflow-x-visible bg-transparent" : "overflow-x-hidden bg-white",
        )}
      >
        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-transparent pb-8 pt-[max(4.5rem,calc(env(safe-area-inset-top)+1.35rem))]">
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

          {isStackIntro ? (
            <div className={cn(stackVisualShellClass, frames.length === 0 && STACK_VISUAL_MIN_H)}>
              {frames.length > 0 ? <OnboardingIntroImageStack frames={frames} /> : null}
            </div>
          ) : isGridIntro ? (
            <div className="relative z-20 mx-auto flex min-h-0 w-full max-w-[min(100%,440px)] flex-1 flex-col justify-center py-3 sm:py-5">
              <OnboardingIntroImageGrid frames={frames} />
            </div>
          ) : isCarouselIntro ? (
            <div className={cn("relative z-20 mx-auto flex min-h-0 w-full max-w-[min(100%,440px)] flex-1 flex-col py-2", frames.length === 0 && CAROUSEL_VISUAL_MIN_H)}>
              {frames.length > 0 ? (
                <OnboardingIntroImageCarousel frames={frames} onCarouselVisualUpdate={applyCarouselVisual} />
              ) : null}
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
