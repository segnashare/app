import type { PhotoModifyAspect } from "@/lib/onboarding/photoModifyStore";

export type ItemPhotoLayout = "portrait" | "landscape";

export const ITEM_PHOTOS_LAYOUT_STORAGE_KEY = "segna:new-item:photos-layout";

export function parseItemPhotosLayout(raw: unknown): ItemPhotoLayout {
  if (!raw || typeof raw !== "object") return "portrait";
  const layout = (raw as Record<string, unknown>).layout;
  return layout === "landscape" ? "landscape" : "portrait";
}

export function itemPhotoLayoutToModifyAspect(layout: ItemPhotoLayout): PhotoModifyAspect {
  return layout === "landscape" ? "landscape" : "portrait";
}

export function itemPhotoStageRatio(layout: ItemPhotoLayout): number {
  return layout === "landscape" ? 4 / 3 : 3 / 4;
}

export function itemPhotoSlotAspectClass(layout: ItemPhotoLayout): string {
  return layout === "landscape" ? "aspect-[4/3]" : "aspect-[3/4]";
}

export function itemPhotoEditorGridClass(layout: ItemPhotoLayout): string {
  return layout === "landscape" ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2";
}

export const ITEM_LIST_SQUARE_THUMB_FRAME_CLASS = "aspect-square w-[100px] shrink-0 rounded-md";

export const ITEM_SQUARE_THUMB_COVER_STYLE = {
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
} as const;

type ItemPhotoPosition = {
  offset?: { x?: number; y?: number };
  zoom?: number;
  aspect?: string;
} | null;

/** Tolérance autour du ratio 1:1 pour classer portrait / paysage. */
const ITEM_PHOTO_LANDSCAPE_RATIO_MIN = 1.08;
const ITEM_PHOTO_PORTRAIT_RATIO_MAX = 0.92;

/** Le layout item (portrait / paysage) ne correspond pas à l’orientation de l’image source. */
export function itemPhotoLayoutMismatchesImageRatio(
  photosLayout: ItemPhotoLayout,
  imageRatio: number,
): boolean {
  if (!Number.isFinite(imageRatio) || imageRatio <= 0) return false;
  if (photosLayout === "portrait" && imageRatio >= ITEM_PHOTO_LANDSCAPE_RATIO_MIN) return true;
  if (photosLayout === "landscape" && imageRatio <= ITEM_PHOTO_PORTRAIT_RATIO_MAX) return true;
  return false;
}

/** Cadre d’affichage : carré si mismatch layout ↔ image, sinon le ratio catalogue habituel. */
export function itemPhotoDisplayAspectClass(
  photosLayout: ItemPhotoLayout,
  imageRatio: number | null | undefined,
): string {
  if (imageRatio != null && itemPhotoLayoutMismatchesImageRatio(photosLayout, imageRatio)) {
    return "aspect-square";
  }
  return itemPhotoSlotAspectClass(photosLayout);
}

/** Vignettes liste carrées : cover centré si paysage ou mismatch layout ↔ image. */
export function itemSquareListThumbCoverProps(options: {
  photosLayout?: ItemPhotoLayout | null;
  photoPosition?: ItemPhotoPosition;
  imageRatio?: number | null;
}): {
  photoPosition?: ItemPhotoPosition;
  coverStyle?: typeof ITEM_SQUARE_THUMB_COVER_STYLE;
} {
  const layout = resolveItemPhotoLayout({
    photosLayout: options.photosLayout ?? null,
    photoAspect: options.photoPosition?.aspect ?? null,
  });
  const mismatch =
    options.imageRatio != null && itemPhotoLayoutMismatchesImageRatio(layout, options.imageRatio);

  if (layout === "landscape" || mismatch) {
    return { coverStyle: ITEM_SQUARE_THUMB_COVER_STYLE };
  }
  return { photoPosition: options.photoPosition ?? null };
}

export function resolveItemPhotoLayout(options: {
  photosLayout?: ItemPhotoLayout | null;
  photoAspect?: string | null;
}): ItemPhotoLayout {
  if (options.photosLayout === "landscape") return "landscape";
  if (options.photoAspect === "landscape") return "landscape";
  return "portrait";
}

export function readItemPhotosLayoutDraft(): ItemPhotoLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ITEM_PHOTOS_LAYOUT_STORAGE_KEY);
    return raw === "landscape" ? "landscape" : raw === "portrait" ? "portrait" : null;
  } catch {
    return null;
  }
}

export function writeItemPhotosLayoutDraft(layout: ItemPhotoLayout) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ITEM_PHOTOS_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // ignore
  }
}

export function clearItemPhotosLayoutDraft() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ITEM_PHOTOS_LAYOUT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
