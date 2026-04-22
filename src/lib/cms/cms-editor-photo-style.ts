import type { CSSProperties } from "react";

/** Aligné sur le backoffice `CMS_PHOTO_CROP_MIN_ZOOM` / `MAX` (recadrage CMS). */
const CMS_PHOTO_COVER_ZOOM_MIN = 0.82;
const CMS_PHOTO_COVER_ZOOM_MAX = 4;

function clampCmsPhotoCoverZoom(zoom: unknown): number {
  const raw = Number(zoom ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(CMS_PHOTO_COVER_ZOOM_MAX, Math.max(CMS_PHOTO_COVER_ZOOM_MIN, raw));
}

/**
 * Style fond « cover » à partir d’offset % + zoom (même convention que `CmsPhotoCropEditor` / aperçu BO).
 * Utilisé par le collage /auth et les vignettes type Exchange.
 */
export function photoCoverStyleFromCmsPosition(
  position: { offset?: { x?: number; y?: number }; zoom?: number } | null | undefined,
): Pick<CSSProperties, "backgroundSize" | "backgroundPosition" | "backgroundRepeat"> {
  const z = clampCmsPhotoCoverZoom(position?.zoom);
  return {
    backgroundSize: `${Math.max(12, z * 100)}%`,
    backgroundPosition: `calc(50% + ${Number(position?.offset?.x ?? 0)}%) calc(50% + ${Number(position?.offset?.y ?? 0)}%)`,
    backgroundRepeat: "no-repeat",
  };
}

/**
 * Même logique que `CmsPhotoCropEditor` (`backgroundSizePercent` + offsets) pour que
 * le rendu catalogue colle au recadrage BO (WYSIWYG).
 */
export function backgroundStyleCmsPhotoEditorMatch(params: {
  photoUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  containerWidth: number;
  containerHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}): CSSProperties | null {
  const {
    photoUrl,
    naturalWidth,
    naturalHeight,
    containerWidth,
    containerHeight,
    zoom,
    offsetX,
    offsetY,
  } = params;
  if (naturalWidth <= 0 || naturalHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return null;
  }
  const imageRatio = naturalWidth / naturalHeight;
  const containerRatio = containerWidth / containerHeight;
  const baseWidthPercent = Math.max(100, 100 * (imageRatio / containerRatio));
  return {
    backgroundImage: `url(${photoUrl})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: `calc(50% + ${offsetX}%) calc(50% + ${offsetY}%)`,
    backgroundSize: `${baseWidthPercent * zoom}%`,
  };
}
