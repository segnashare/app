"use client";

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils/cn";

type SegnaSkeletonBlockProps = {
  className?: string;
  rounded?: string;
  style?: CSSProperties;
  /** Durée d’une passe du balayage (défaut CSS ~2,85s). */
  shimmerDurationSec?: number;
};

/**
 * Zone grise avec balayage diagonal (même animation que le catalogue shop).
 * Le parent doit avoir des dimensions (ex. aspect-square, h-*, w-*).
 */
export function SegnaSkeletonBlock({
  className,
  rounded = "rounded-2xl",
  style,
  shimmerDurationSec,
}: SegnaSkeletonBlockProps) {
  const mergedStyle: CSSProperties = {
    ...style,
    ...(shimmerDurationSec != null
      ? ({ ["--shop-shimmer-duration" as string]: `${shimmerDurationSec}s` } as CSSProperties)
      : {}),
  };
  return (
    <div className={cn("relative overflow-hidden", rounded, className)} style={mergedStyle}>
      <div className="shop-catalog-image-skeleton" aria-hidden />
    </div>
  );
}
