"use client";

import { Image as ImageIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { backgroundStyleCmsPhotoEditorMatch } from "@/lib/cms/cms-editor-photo-style";
import {
  ITEM_SQUARE_THUMB_COVER_STYLE,
  itemPhotoLayoutMismatchesImageRatio,
  type ItemPhotoLayout,
} from "@/lib/items/item-photo-layout";
import { cn } from "@/lib/utils/cn";

/** Aligné sur `CMS_PHOTO_CROP_MIN_ZOOM` / `CMS_PHOTO_CROP_MAX_ZOOM` (backoffice). */
const CMS_PHOTO_ZOOM_MIN = 0.82;
const CMS_PHOTO_ZOOM_MAX = 4;

export type RemoteCoverLoadState = "loading" | "ready" | "failed";

type PhotoPosition = {
  offset?: { x?: number; y?: number };
  zoom?: number;
  aspect?: string;
} | null;

function clampCmsPhotoZoom(zoom: unknown): number {
  const raw = Number(zoom ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(CMS_PHOTO_ZOOM_MAX, Math.max(CMS_PHOTO_ZOOM_MIN, raw));
}

type RemoteCoverThumbProps = {
  photoUrl: string;
  /** Classes for the outer frame (e.g. aspect-square w-[100px] rounded-md) */
  frameClassName?: string;
  className?: string;
  /** État de chargement du visuel (titre / méta peuvent attendre `ready`). */
  onLoadStateChange?: (state: RemoteCoverLoadState) => void;
  /**
   * Exchange-style crop (offset % + zoom as scale of 100%).
   * Ignored if `coverStyle` is passed.
   */
  photoPosition?: PhotoPosition;
  /**
   * Full background-* style except `backgroundImage` (added when loaded).
   * Use for item view slots (imageRatio × zoom sizing).
   */
  coverStyle?: Pick<CSSProperties, "backgroundSize" | "backgroundPosition" | "backgroundRepeat">;
  /**
   * Photo CMS bandeau split pièce : même moteur que `CmsPhotoCropEditor` (ratio image × cadre + zoom × offset)
   * pour coller au positionnement BO (évite `cover` + `scale`, qui décalait le cadrage).
   */
  photoCoverFill?: boolean;
  /**
   * Layout catalogue de la pièce : si incompatible avec l’orientation réelle de l’image,
   * bascule en cover carré centré (pas de bandes grises).
   */
  photosLayout?: ItemPhotoLayout;
  onImageDimensions?: (size: { w: number; h: number }) => void;
  /** Si le parent affiche son propre squelette plein cadre (ex. carte split pièce). */
  suppressLoadSkeleton?: boolean;
};

function exchangeCoverStyle(photoPosition: PhotoPosition): Pick<CSSProperties, "backgroundSize" | "backgroundPosition" | "backgroundRepeat"> {
  const z = clampCmsPhotoZoom(photoPosition?.zoom);
  return {
    backgroundSize: `${Math.max(12, z * 100)}%`,
    backgroundPosition: `calc(50% + ${Number(photoPosition?.offset?.x ?? 0)}%) calc(50% + ${Number(photoPosition?.offset?.y ?? 0)}%)`,
    backgroundRepeat: "no-repeat",
  };
}

/**
 * Squelette balayage puis fond crop : affichage net seulement après chargement (pas de dévoilement progressif).
 */
export function RemoteCoverThumb(props: RemoteCoverThumbProps) {
  return <RemoteCoverThumbImpl {...props} />;
}

function RemoteCoverThumbImpl({
  photoUrl,
  frameClassName,
  className,
  photoPosition,
  coverStyle,
  photoCoverFill,
  photosLayout,
  onImageDimensions,
  suppressLoadSkeleton = false,
  onLoadStateChange,
}: RemoteCoverThumbProps) {
  const canPaintBeforeDecode = Boolean(coverStyle && !photoCoverFill);
  const [ready, setReady] = useState(canPaintBeforeDecode);
  const [failed, setFailed] = useState(false);
  const [loadedPhotoUrl, setLoadedPhotoUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [containerBox, setContainerBox] = useState({ w: 0, h: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const loadedPhotoUrlRef = useRef<string | null>(null);
  const onLoadStateChangeRef = useRef(onLoadStateChange);

  const pos = photoPosition ?? null;
  const imageRatio = naturalSize && naturalSize.h > 0 ? naturalSize.w / naturalSize.h : null;
  const layoutMismatch = Boolean(
    photosLayout && imageRatio != null && itemPhotoLayoutMismatchesImageRatio(photosLayout, imageRatio),
  );
  const squareCoverFallback = layoutMismatch ? ITEM_SQUARE_THUMB_COVER_STYLE : undefined;
  const resolvedCoverStyle = coverStyle ?? squareCoverFallback;
  const useCoverFill = Boolean(photoCoverFill && !resolvedCoverStyle && !layoutMismatch);
  const bgExtras = resolvedCoverStyle ?? exchangeCoverStyle(pos);
  const displayedPhotoUrl = loadedPhotoUrl ?? photoUrl;
  const shouldPaintPhoto = ready || canPaintBeforeDecode;

  useEffect(() => {
    onLoadStateChangeRef.current = onLoadStateChange;
  }, [onLoadStateChange]);

  useEffect(() => {
    const state: RemoteCoverLoadState = failed ? "failed" : ready ? "ready" : "loading";
    onLoadStateChangeRef.current?.(state);
  }, [ready, failed]);

  useEffect(() => {
    let cancelled = false;
    if (canPaintBeforeDecode) {
      loadedPhotoUrlRef.current = photoUrl;
      setLoadedPhotoUrl(photoUrl);
      setReady(true);
    }
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      // Paint as soon as the browser has dimensions — don't block on decode().
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      loadedPhotoUrlRef.current = photoUrl;
      setLoadedPhotoUrl(photoUrl);
      setFailed(false);
      setReady(true);
      if (typeof img.decode === "function") {
        void img.decode().catch(() => {
          /* ignore */
        });
      }
    };
    img.onerror = () => {
      if (!cancelled && !loadedPhotoUrlRef.current) {
        setFailed(true);
      }
    };
    img.src = photoUrl;
    return () => {
      cancelled = true;
    };
  }, [canPaintBeforeDecode, photoUrl]);

  useEffect(() => {
    if (!naturalSize || naturalSize.w <= 0 || naturalSize.h <= 0) return;
    onImageDimensions?.({ w: naturalSize.w, h: naturalSize.h });
  }, [naturalSize, onImageDimensions]);

  useLayoutEffect(() => {
    if (!useCoverFill || !ready) return;
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setContainerBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [useCoverFill, ready, displayedPhotoUrl]);

  const cmsMatchedFillStyle = useMemo(() => {
    if (!useCoverFill || !ready) return null;
    const z = clampCmsPhotoZoom(pos?.zoom);
    const ox = Number(pos?.offset?.x ?? 0);
    const oy = Number(pos?.offset?.y ?? 0);
    if (!naturalSize || containerBox.w <= 0 || containerBox.h <= 0) return null;
    return backgroundStyleCmsPhotoEditorMatch({
      photoUrl: displayedPhotoUrl,
      naturalWidth: naturalSize.w,
      naturalHeight: naturalSize.h,
      containerWidth: containerBox.w,
      containerHeight: containerBox.h,
      zoom: z,
      offsetX: ox,
      offsetY: oy,
    });
  }, [
    useCoverFill,
    ready,
    displayedPhotoUrl,
    naturalSize,
    containerBox.w,
    containerBox.h,
    pos?.zoom,
    pos?.offset?.x,
    pos?.offset?.y,
  ]);

  const fillLayerStyle =
    useCoverFill && ready
      ? (cmsMatchedFillStyle ?? {
          ...exchangeCoverStyle(pos),
          backgroundImage: `url(${displayedPhotoUrl})`,
        })
      : null;

  const flatCoverLayerStyle =
    resolvedCoverStyle && ready && !useCoverFill
      ? {
          ...resolvedCoverStyle,
          backgroundImage: `url(${displayedPhotoUrl})`,
        }
      : null;

  return (
    <div
      ref={frameRef}
      className={cn(
        "relative overflow-hidden bg-zinc-200",
        frameClassName,
      )}
    >
      {/* Balayage pendant le chargement — plus de fond noir `bg-zinc-950` qui masquait le skeleton. */}
      {!suppressLoadSkeleton && !failed && !shouldPaintPhoto ? (
        <SegnaSkeletonBlock
          className="pointer-events-none absolute inset-0 z-[2]"
          rounded="rounded-none"
        />
      ) : null}
      {failed ? (
        <div className="relative z-[1] flex h-full w-full items-center justify-center bg-zinc-200 text-zinc-400">
          <ImageIcon className="h-7 w-7 opacity-50" aria-hidden />
        </div>
      ) : shouldPaintPhoto ? (
        useCoverFill && fillLayerStyle ? (
          <div
            className={cn("relative z-[1] h-full w-full bg-no-repeat", className)}
            style={fillLayerStyle}
          />
        ) : flatCoverLayerStyle ? (
          <div
            className={cn("relative z-[1] h-full w-full bg-no-repeat", className)}
            style={flatCoverLayerStyle}
          />
        ) : (
          <div
            className={cn("relative z-[1] h-full w-full bg-center bg-no-repeat", className)}
            style={{
              ...bgExtras,
              backgroundImage: `url(${displayedPhotoUrl})`,
            }}
          />
        )
      ) : null}
    </div>
  );
}
