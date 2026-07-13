"use client";

const ITEM_INFO_DRAFT_STORAGE_KEY = "segna:new-item:info-draft";
const LAST_DB_LOAD_STORAGE_KEY = "segna:new-item:last-db-load";

export type ItemInfoDraft = {
  categoryId?: string | null;
  category?: string | null;
  brandId?: string | null;
  brand?: string | null;
  /** Slug `item_brands.slug` (ex. `autre` pour marque libre). */
  brandSlug?: string | null;
  /** Libellé libre formaté (marque « Autre » uniquement), max 30 car. */
  customBrandLabel?: string | null;
  sizeId?: string | null;
  size?: string | null;
  recommendedSizeId?: string | null;
  recommendedSize?: string | null;
  photographedOnMannequin?: boolean;
  mannequinId?: string | null;
  mannequinFirstName?: string | null;
  condition?: string | null;
  conditionDetails?: string | null;
  conditionDefectPhotoCount?: string | null;
  colorId?: string | null;
  color?: string | null;
  materialsId?: string | null;
  materials?: string | null;
};

const emptyDraft: ItemInfoDraft = {};

function safeParse(raw: string | null): ItemInfoDraft {
  if (!raw || typeof raw !== "string") return { ...emptyDraft };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return { ...emptyDraft };
    return {
      categoryId: stringOrNull(parsed.categoryId),
      category: stringOrNull(parsed.category),
      brandId: stringOrNull(parsed.brandId),
      brand: stringOrNull(parsed.brand),
      brandSlug: stringOrNull(parsed.brandSlug),
      customBrandLabel: stringOrNull(parsed.customBrandLabel),
      sizeId: stringOrNull(parsed.sizeId),
      size: stringOrNull(parsed.size),
      recommendedSizeId: stringOrNull(parsed.recommendedSizeId),
      recommendedSize: stringOrNull(parsed.recommendedSize),
      photographedOnMannequin:
        parsed.photographedOnMannequin === true || parsed.photographedOnMannequin === "true",
      mannequinId: stringOrNull(parsed.mannequinId),
      mannequinFirstName: stringOrNull(parsed.mannequinFirstName),
      condition: stringOrNull(parsed.condition),
      conditionDetails: stringOrNull(parsed.conditionDetails),
      conditionDefectPhotoCount: stringOrNull(parsed.conditionDefectPhotoCount),
      colorId: stringOrNull(parsed.colorId),
      color: stringOrNull(parsed.color),
      materialsId: stringOrNull(parsed.materialsId),
      materials: stringOrNull(parsed.materials),
    };
  } catch {
    return { ...emptyDraft };
  }
}

function stringOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  return String(v).trim() || null;
}

export function getItemInfoDraft(): ItemInfoDraft {
  if (typeof window === "undefined") return { ...emptyDraft };
  const raw = window.sessionStorage.getItem(ITEM_INFO_DRAFT_STORAGE_KEY);
  return safeParse(raw);
}

export function setItemInfoDraft(draft: ItemInfoDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ITEM_INFO_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Best effort only.
  }
}

export function mergeItemInfoDraft(partial: Partial<ItemInfoDraft>): void {
  setItemInfoDraft({ ...getItemInfoDraft(), ...partial });
}

export function clearItemInfoDraft(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ITEM_INFO_DRAFT_STORAGE_KEY);
  window.sessionStorage.removeItem(LAST_DB_LOAD_STORAGE_KEY);
}

export function setLastDbLoadedItemId(itemId: string | null): void {
  if (typeof window === "undefined") return;
  if (itemId) {
    window.sessionStorage.setItem(LAST_DB_LOAD_STORAGE_KEY, itemId);
  } else {
    window.sessionStorage.removeItem(LAST_DB_LOAD_STORAGE_KEY);
  }
}

export function getLastDbLoadedItemId(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(LAST_DB_LOAD_STORAGE_KEY);
}
