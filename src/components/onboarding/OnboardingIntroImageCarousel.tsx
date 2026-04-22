"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "framer-motion";

import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { photoCoverStyleFromCmsPosition } from "@/lib/cms/cms-editor-photo-style";
import { lerpHexColors } from "@/lib/ui/lerp-hex-color";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

import stackStyles from "./OnboardingIntroImageStack.module.css";

const montserrat = segnaMontserrat;

export type OnboardingCarouselVisualState = {
  /** Diapositive la plus proche du centre (arrondi). */
  activeIndex: number;
  /** Couleur de fond à afficher hors carrousel (titre, CTA) — interpolée pendant le balayage. */
  backgroundHex: string;
};

function aspectClass(aspect: string | undefined) {
  if (aspect === "portrait") return stackStyles.aspectPortrait;
  if (aspect === "landscape") return stackStyles.aspectLandscape;
  return stackStyles.aspectSquare;
}

function sizeClass(size: string | undefined) {
  if (size === "medium") return stackStyles.sizeMedium;
  if (size === "large") return stackStyles.sizeLarge;
  return stackStyles.sizeSmall;
}

function slideImageStyle(row: CmsFrameRow): CSSProperties {
  const p = row.payload;
  const url = p.collage_image?.signed_url;
  const hasUrl = Boolean(url);
  const img = p.collage_image;
  const pos =
    img && typeof img === "object" && img.position && typeof img.position === "object" && !Array.isArray(img.position)
      ? (img.position as { offset?: { x?: number; y?: number }; zoom?: number })
      : null;
  if (hasUrl && url) {
    return {
      backgroundImage: `url(${url})`,
      backgroundColor: "#f4f4f5",
      ...photoCoverStyleFromCmsPosition(pos),
    };
  }
  return { background: "linear-gradient(135deg, #f4f4f5 0%, #e4e4e7 100%)" };
}

export function normalizeSlideBackgroundHex(raw: string | undefined | null, fallback: string): string {
  if (!raw || typeof raw !== "string") return fallback;
  const t = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t;
  if (/^[0-9a-fA-F]{6}$/.test(t)) return `#${t}`;
  return fallback;
}

/** true si fond très clair → texte foncé sur la légende slide. */
export function isLightBackgroundHex(hex: string): boolean {
  const n = hex.replace("#", "");
  if (n.length !== 6) return true;
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return true;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.72;
}

function computeCarouselVisualState(list: CmsFrameRow[], scrollProgress: number): OnboardingCarouselVisualState {
  if (list.length === 0) {
    return { activeIndex: 0, backgroundHex: "#ffffff" };
  }
  const maxIdx = list.length - 1;
  const idxFloat =
    maxIdx <= 0 ? 0 : Math.min(Math.max(scrollProgress * maxIdx, 0), maxIdx);
  const i0 = Math.min(Math.floor(idxFloat + 1e-9), maxIdx);
  const i1 = Math.min(i0 + 1, maxIdx);
  const t = idxFloat - i0;
  const hex0 = normalizeSlideBackgroundHex(list[i0].payload.slide_background_hex, "#ffffff");
  const hex1 = normalizeSlideBackgroundHex(list[i1].payload.slide_background_hex, "#ffffff");
  const backgroundHex = i0 === i1 ? hex0 : lerpHexColors(hex0, hex1, t);
  const activeIndex = Math.round(idxFloat);
  return { activeIndex, backgroundHex };
}

function IntroCarouselSlideFrame({
  row,
  index,
  slideCount,
  scrollXProgress,
}: {
  row: CmsFrameRow;
  index: number;
  slideCount: number;
  scrollXProgress: MotionValue<number>;
}) {
  const p = row.payload;
  const driftX = useTransform(scrollXProgress, (progress) => {
    if (slideCount <= 1) return 0;
    const pos = progress * (slideCount - 1);
    return (pos - index) * -22;
  });
  const driftScale = useTransform(scrollXProgress, (progress) => {
    if (slideCount <= 1) return 2;
    const pos = progress * (slideCount - 1);
    const d = Math.abs(pos - index);
    return (1 - Math.min(d, 1) * 0.045) * 2;
  });

  return (
    <motion.div
      className={cn(
        "max-w-full origin-center overflow-hidden rounded-[10px] shadow-md",
        aspectClass(p.collage_aspect),
        sizeClass(p.collage_size),
      )}
      style={{ ...slideImageStyle(row), x: driftX, scale: driftScale }}
    />
  );
}

type OnboardingIntroImageCarouselProps = {
  frames: CmsFrameRow[];
  /** Suivi scroll : couleur fond interpolée + index actif (comme tryptique / hero site). */
  onCarouselVisualUpdate?: (state: OnboardingCarouselVisualState) => void;
  className?: string;
};

/**
 * Carrousel horizontal (snap) : une frame CMS par écran, balayage latéral.
 * Couleur de page : interpolation entre `slide_background_hex` des diapositives pendant le scroll.
 * Visuels : léger décalage + scale liés au scroll (esprit hero / tryptique du site).
 */
export function OnboardingIntroImageCarousel({ frames, onCarouselVisualUpdate, className }: OnboardingIntroImageCarouselProps) {
  const sorted = useMemo(() => [...frames].sort((a, b) => a.sort_order - b.sort_order), [frames]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { scrollXProgress } = useScroll({ container: scrollerRef });

  const emitVisual = useCallback(
    (p: number) => {
      if (!onCarouselVisualUpdate || sorted.length === 0) return;
      onCarouselVisualUpdate(computeCarouselVisualState(sorted, p));
    },
    [sorted, onCarouselVisualUpdate],
  );

  useMotionValueEvent(scrollXProgress, "change", emitVisual);

  useLayoutEffect(() => {
    emitVisual(scrollXProgress.get());
  }, [emitVisual, scrollXProgress, sorted]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      emitVisual(scrollXProgress.get());
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [emitVisual, scrollXProgress, sorted.length]);

  if (sorted.length === 0) return null;

  const slideCount = sorted.length;

  return (
    <div className={cn(montserrat.className, "flex min-h-0 w-full flex-1 flex-col", className)}>
      <div
        ref={scrollerRef}
        className={cn(
          "flex min-h-0 w-full flex-1 touch-pan-x snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain",
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
        style={{ WebkitOverflowScrolling: "touch" }}
        aria-roledescription="carousel"
        aria-label="Visuels d’introduction — glisser horizontalement"
      >
        {sorted.map((row, index) => {
          const p = row.payload;
          const slideBg = normalizeSlideBackgroundHex(p.slide_background_hex, "#ffffff");
          const lightSlide = isLightBackgroundHex(slideBg);
          return (
            <div
              key={row.id}
              className="flex min-h-0 w-full min-w-full shrink-0 snap-center snap-always flex-col items-center justify-center gap-4 overflow-x-hidden px-4 py-8 sm:gap-5 sm:px-5 sm:py-12"
              style={{ backgroundColor: slideBg }}
            >
              <div className="flex shrink-0 items-center justify-center py-2 sm:py-4">
                <IntroCarouselSlideFrame
                  row={row}
                  index={index}
                  slideCount={slideCount}
                  scrollXProgress={scrollXProgress}
                />
              </div>
              {p.title ? (
                <p
                  className={cn(
                    "w-full max-w-[min(100%,360px)] text-balance text-center text-[clamp(15px,3.8vw,18px)] font-bold leading-snug tracking-tight transition-[opacity,transform] duration-300 ease-out",
                    lightSlide
                      ? "text-zinc-900"
                      : "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]",
                  )}
                >
                  {p.title}
                </p>
              ) : null}
              {p.subtitle ? (
                <p
                  className={cn(
                    "w-full max-w-[min(100%,360px)] text-balance text-center text-[13px] font-semibold leading-snug transition-opacity duration-300 ease-out sm:text-[14px]",
                    lightSlide ? "text-zinc-600" : "text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]",
                  )}
                >
                  {p.subtitle}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
