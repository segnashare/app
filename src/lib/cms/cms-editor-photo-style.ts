import type { CSSProperties } from "react";

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
