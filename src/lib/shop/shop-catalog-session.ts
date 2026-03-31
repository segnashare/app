/** Persistance du catalogue (retour depuis une fiche article avec router.back). */

export const SHOP_CATALOG_STATE_KEY = "segna:shop-catalog-state";
export const SHOP_CATALOG_SCROLL_KEY = "segna:shop-catalog-scroll-y";
export const SHOP_CATALOG_RESTORE_PENDING = "segna:shop-catalog-restore-pending";

/** Filtres catalogue persistés (marques / couleurs / tailles = sélection multiple). */
export type ShopCatalogFiltersPersisted = {
  categoryId: string | null;
  brandIds: string[];
  colorIds: string[];
  sizeIds: string[];
  materialId: string | null;
  conditionScore: string | null;
};

/** Migre l’ancien format (un seul id) vers tableaux. */
export function parseShopCatalogFilters(raw: unknown): ShopCatalogFiltersPersisted {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
  const arr = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((i): i is string => typeof i === "string" && i.trim().length > 0) : [];

  let brandIds = arr(d.brandIds);
  if (brandIds.length === 0) {
    const legacy = str(d.brandId);
    if (legacy) brandIds = [legacy];
  }
  let colorIds = arr(d.colorIds);
  if (colorIds.length === 0) {
    const legacy = str(d.colorId);
    if (legacy) colorIds = [legacy];
  }
  let sizeIds = arr(d.sizeIds);
  if (sizeIds.length === 0) {
    const legacy = str(d.sizeId);
    if (legacy) sizeIds = [legacy];
  }

  return {
    categoryId: str(d.categoryId),
    brandIds,
    colorIds,
    sizeIds,
    materialId: str(d.materialId),
    conditionScore: str(d.conditionScore),
  };
}

export type ShopCatalogSessionSnapshot = {
  search: string;
  sortMode: "recent" | "price_asc" | "price_desc";
  heartsOnly: boolean;
  disponiblesOnly: boolean;
  filters: ShopCatalogFiltersPersisted;
};

type RestoreStash = { snap: ShopCatalogSessionSnapshot; scrollY: number | null };

let strictModeRestoreFallback: RestoreStash | null = null;
let fallbackClearId: number | null = null;

function scheduleClearShopCatalogRestoreFallback() {
  if (typeof window === "undefined") return;
  if (fallbackClearId != null) window.clearTimeout(fallbackClearId);
  fallbackClearId = window.setTimeout(() => {
    strictModeRestoreFallback = null;
    fallbackClearId = null;
  }, 280);
}

export function stashShopCatalogRestoreForStrictRemount(stash: RestoreStash) {
  if (fallbackClearId != null) {
    window.clearTimeout(fallbackClearId);
    fallbackClearId = null;
  }
  strictModeRestoreFallback = stash;
  scheduleClearShopCatalogRestoreFallback();
}

export function takeShopCatalogStrictRemountFallback(): RestoreStash | null {
  if (typeof window === "undefined") return null;
  if (fallbackClearId != null) {
    window.clearTimeout(fallbackClearId);
    fallbackClearId = null;
  }
  const s = strictModeRestoreFallback;
  strictModeRestoreFallback = null;
  return s;
}

export function persistShopCatalogStateForItemNavigation(snapshot: ShopCatalogSessionSnapshot) {
  if (typeof window === "undefined") return;
  strictModeRestoreFallback = null;
  if (fallbackClearId != null) {
    window.clearTimeout(fallbackClearId);
    fallbackClearId = null;
  }
  try {
    window.sessionStorage.setItem(SHOP_CATALOG_STATE_KEY, JSON.stringify(snapshot));
    window.sessionStorage.setItem(SHOP_CATALOG_SCROLL_KEY, String(window.scrollY));
    window.sessionStorage.setItem(SHOP_CATALOG_RESTORE_PENDING, "1");
  } catch {
    // no-op
  }
}

export function readShopCatalogRestorePendingSnapshot(): ShopCatalogSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  if (window.sessionStorage.getItem(SHOP_CATALOG_RESTORE_PENDING) !== "1") return null;
  try {
    const raw = window.sessionStorage.getItem(SHOP_CATALOG_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ShopCatalogSessionSnapshot;
  } catch {
    return null;
  }
}

export function consumeShopCatalogRestoreFromStorage(): { scrollY: number | null } {
  if (typeof window === "undefined") return { scrollY: null };
  try {
    window.sessionStorage.removeItem(SHOP_CATALOG_RESTORE_PENDING);
    window.sessionStorage.removeItem(SHOP_CATALOG_STATE_KEY);
    const sy = window.sessionStorage.getItem(SHOP_CATALOG_SCROLL_KEY);
    window.sessionStorage.removeItem(SHOP_CATALOG_SCROLL_KEY);
    const y = sy != null ? Number(sy) : NaN;
    return { scrollY: Number.isFinite(y) ? y : null };
  } catch {
    return { scrollY: null };
  }
}
