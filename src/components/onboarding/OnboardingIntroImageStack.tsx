"use client";

import type { CSSProperties } from "react";

import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { photoCoverStyleFromCmsPosition } from "@/lib/cms/cms-editor-photo-style";
import { cn } from "@/lib/utils/cn";

import stackStyles from "./OnboardingIntroImageStack.module.css";

type OnboardingIntroImageStackProps = {
  frames: CmsFrameRow[];
  className?: string;
};

/** Ratios identiques au collage auth ; largeurs ×1,5 (`OnboardingIntroImageStack.module.css`). */
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

/**
 * Affiche les frames CMS `onboarding_stack_image` en pile verticale (pas de position % ni animation).
 */
export function OnboardingIntroImageStack({ frames, className }: OnboardingIntroImageStackProps) {
  const rows = [...frames].sort((a, b) => a.sort_order - b.sort_order);
  if (rows.length === 0) return null;

  return (
    <div
      className={cn(
        stackStyles.stackRowDesktop,
        "flex w-full max-w-full flex-col items-center justify-center gap-3 md:flex-row md:items-center md:justify-center md:gap-5 lg:gap-7",
        className,
      )}
    >
      {rows.map((row) => {
        const p = row.payload;
        const url = p.collage_image?.signed_url;
        const hasUrl = Boolean(url);
        const img = p.collage_image;
        const pos =
          img && typeof img === "object" && img.position && typeof img.position === "object" && !Array.isArray(img.position)
            ? (img.position as { offset?: { x?: number; y?: number }; zoom?: number })
            : null;
        const backgroundStyle: CSSProperties | undefined = hasUrl
          ? {
              backgroundImage: `url(${url})`,
              backgroundColor: "#f4f4f5",
              ...photoCoverStyleFromCmsPosition(pos),
            }
          : {
              backgroundImage: "linear-gradient(135deg, #f4f4f5 0%, #e4e4e7 100%)",
            };

        return (
          <div
            key={row.id}
            className={cn(
              "shrink-0 overflow-hidden rounded-[10px] shadow-sm",
              sizeClass(p.collage_size),
              aspectClass(p.collage_aspect),
            )}
            style={backgroundStyle}
            aria-hidden
          />
        );
      })}
    </div>
  );
}
