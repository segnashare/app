"use client";

import type { CSSProperties } from "react";

import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { photoCoverStyleFromCmsPosition } from "@/lib/cms/cms-editor-photo-style";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

import stackStyles from "./OnboardingIntroImageStack.module.css";

const montserrat = segnaMontserrat;

/** Mêmes ratios / largeurs que `OnboardingIntroImageStack` (payload CMS `collage_aspect`, `collage_size`). */
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

type OnboardingIntroImageGridProps = {
  frames: CmsFrameRow[];
  className?: string;
};

function tileBackground(row: CmsFrameRow | null): CSSProperties {
  if (!row) {
    return { background: "linear-gradient(135deg, #f4f4f5 0%, #e4e4e7 100%)" };
  }
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

/**
 * Grille 2×2 (max 4 vignettes CMS `onboarding_stack_image`) : cadre selon `collage_aspect` / `collage_size` + titre + sous-titre.
 */
export function OnboardingIntroImageGrid({ frames, className }: OnboardingIntroImageGridProps) {
  const sorted = [...frames].sort((a, b) => a.sort_order - b.sort_order);
  const slots: Array<CmsFrameRow | null> = Array.from({ length: 4 }, (_, i) => sorted[i] ?? null);

  return (
    <div
      className={cn(
        montserrat.className,
        stackStyles.introGridFrame,
        "mx-auto grid w-full max-w-[min(100%,400px)] grid-cols-2 justify-items-center gap-x-3 gap-y-5 px-1 sm:gap-x-4 sm:gap-y-6",
        className,
      )}
    >
      {slots.map((row, idx) => (
        <div key={row?.id ?? `onboarding-grid-slot-${idx}`} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
          <div
            className={cn(
              "max-w-full shrink-0 overflow-hidden rounded-[10px] shadow-sm",
              row ? aspectClass(row.payload.collage_aspect) : stackStyles.aspectSquare,
              row ? sizeClass(row.payload.collage_size) : stackStyles.sizeMedium,
            )}
            style={tileBackground(row)}
            aria-hidden
          />
          {row?.payload.title ? (
            <p className="w-full text-balance text-[clamp(14px,3.6vw,16px)] font-bold leading-snug tracking-tight text-zinc-900">
              {row.payload.title}
            </p>
          ) : null}
          {row?.payload.subtitle ? (
            <p className="w-full text-balance text-[12px] font-semibold leading-snug text-[#999999] sm:text-[13px]">{row.payload.subtitle}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
