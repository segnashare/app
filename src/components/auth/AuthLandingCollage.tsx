"use client";

import type { AuthCollageFrameRow } from "@/lib/cms/fetch-auth-landing-collage";
import { photoCoverStyleFromCmsPosition } from "@/lib/cms/cms-editor-photo-style";
import { cn } from "@/lib/utils/cn";

import styles from "./AuthLandingCollage.module.css";

type AuthLandingCollageProps = {
  frames: AuthCollageFrameRow[];
  className?: string;
};

function aspectClass(aspect: string | undefined) {
  if (aspect === "portrait") return styles.aspectPortrait;
  if (aspect === "landscape") return styles.aspectLandscape;
  return styles.aspectSquare;
}

function sizeClass(size: string | undefined) {
  if (size === "medium") return styles.sizeMedium;
  if (size === "large") return styles.sizeLarge;
  return styles.sizeSmall;
}

export function AuthLandingCollage({ frames, className }: AuthLandingCollageProps) {
  if (frames.length === 0) return null;

  return (
    <div className={cn(styles.root, className)} aria-hidden>
      {frames.map((row) => {
        const p = row.payload;
        const top = typeof p.collage_top_pct === "number" ? p.collage_top_pct : 50;
        const left = typeof p.collage_left_pct === "number" ? p.collage_left_pct : 50;
        const delayMs = Math.min(
          500,
          typeof p.collage_float_delay_ms === "number" && Number.isFinite(p.collage_float_delay_ms) ? p.collage_float_delay_ms : 0,
        );
        const url = p.collage_image?.signed_url;
        const hasUrl = Boolean(url);
        const img = p.collage_image;
        const pos =
          img && typeof img === "object" && img.position && typeof img.position === "object" && !Array.isArray(img.position)
            ? (img.position as { offset?: { x?: number; y?: number }; zoom?: number })
            : null;
        const coverStyle = hasUrl
          ? {
              backgroundImage: `url(${url})`,
              ...photoCoverStyleFromCmsPosition(pos),
            }
          : undefined;

        return (
          <div
            key={row.id}
            className={cn(styles.slot, aspectClass(p.collage_aspect), sizeClass(p.collage_size))}
            style={{
              top: `${top}%`,
              left: `${left}%`,
              animationDelay: `${delayMs}ms`,
            }}
          >
            <div className={styles.slotInner} style={coverStyle}>
              {!hasUrl ? <div className={styles.placeholder} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
