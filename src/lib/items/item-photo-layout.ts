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
