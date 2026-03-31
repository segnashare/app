"use client";

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import { ArrowRight, ChevronDown, Heart, Plus, Search, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlForStoragePath } from "@/lib/supabase/storage-resolve-signed-url";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import {
  consumeShopCatalogRestoreFromStorage,
  parseShopCatalogFilters,
  persistShopCatalogStateForItemNavigation,
  readShopCatalogRestorePendingSnapshot,
  stashShopCatalogRestoreForStrictRemount,
  takeShopCatalogStrictRemountFallback,
  type ShopCatalogSessionSnapshot,
} from "@/lib/shop/shop-catalog-session";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { useActiveCartItemIds } from "@/hooks/useActiveCartItemIds";
import { cn } from "@/lib/utils/cn";

const SEGNA_ICON = "/ressources/icons/segna.svg";

/** Chips filtres: base grise, active noire, plus plates et moins arrondies. */
const filterChipActiveClass = "border-transparent bg-zinc-950 text-white";
const filterChipInactiveClass = "border-transparent bg-zinc-100 text-zinc-900 hover:bg-zinc-200/90";
const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["600", "700"] });
const sectionTitleClass = "text-[24px] font-bold leading-[1.1] tracking-tight text-zinc-900";

type SortMode = "recent" | "price_asc" | "price_desc";

const SORT_OPTIONS: { mode: SortMode; label: string; description?: string }[] = [
  { mode: "recent", label: "Nouveautés", description: "Les pièces les plus récentes d’abord" },
  { mode: "price_asc", label: "Prix croissant", description: "Du moins cher au plus cher" },
  { mode: "price_desc", label: "Prix décroissant", description: "Du plus cher au moins cher" },
];

export type ShopCatalogItem = {
  id: string;
  title: string;
  description: string | null;
  price_points: number | null;
  status: string;
  photos: unknown;
  item_category_id: string | null;
  item_size_id: string | null;
  item_brand_id: string | null;
  item_couleur_id: string | null;
  item_materiaux_id: string | null;
  category_label: string | null;
  size_label: string | null;
  materials_label: string | null;
  color_label: string | null;
  brand_label: string | null;
  condition_label: string | null;
  condition_score: string | null;
};

type FilterOption = { id: string; label: string };

/** Catégorie boutique avec lien parent → sous-catégories dans le modal. */
export type CategoryFilterOption = FilterOption & { parentId: string | null };

type ModalFilterFamily = "category" | "brand" | "color" | "size";

const MODAL_FILTER_FAMILIES: { id: ModalFilterFamily; label: string }[] = [
  { id: "category", label: "Catégories" },
  { id: "brand", label: "Marques" },
  { id: "color", label: "Couleurs" },
  { id: "size", label: "Tailles" },
];

const CONDITION_OPTIONS: FilterOption[] = [
  { id: "neuf_etiquette", label: "Neuf avec étiquette" },
  { id: "excellent", label: "Excellent état" },
  { id: "tres_bon", label: "Très bon état" },
  { id: "bon", label: "Bon état" },
  { id: "acceptable", label: "Acceptable" },
  { id: "degrade", label: "Dégradé" },
];

const PSEUDO_FRAME_TAGLINES = [
  "Edito Segna",
  "Sélection du moment",
  "Vu sur le feed",
  "Tendance capsule",
  "Drop exclusif",
  "Nouveau chez Segna",
];

const PSEUDO_FRAME_COLORS = [
  "from-[#FDE68A] to-[#FCA5A5]",
  "from-[#BFDBFE] to-[#C4B5FD]",
  "from-[#A7F3D0] to-[#67E8F9]",
  "from-[#FDBA74] to-[#F9A8D4]",
  "from-[#DDD6FE] to-[#93C5FD]",
  "from-[#FECACA] to-[#FDE68A]",
];

type ShopFilters = {
  categoryId: string | null;
  brandIds: string[];
  colorIds: string[];
  sizeIds: string[];
  materialId: string | null;
  conditionScore: string | null;
};

const emptyFilters: ShopFilters = {
  categoryId: null,
  brandIds: [],
  colorIds: [],
  sizeIds: [],
  materialId: null,
  conditionScore: null,
};

type ShopCatalogProps = {
  initialItems: ShopCatalogItem[];
  initialLikedItemIds: string[];
  categories: CategoryFilterOption[];
  sizes: FilterOption[];
  brands: FilterOption[];
  colors: FilterOption[];
  materials: FilterOption[];
};

type MenuKey = keyof ShopFilters;

type OpenPanelKey = MenuKey | "sort";

const MENU_LABELS: Record<MenuKey, string> = {
  categoryId: "Catégorie",
  sizeIds: "Taille",
  brandIds: "Marques",
  colorIds: "Couleur",
  materialId: "Matériaux",
  conditionScore: "État",
};

type MultiFilterKey = "brandIds" | "colorIds" | "sizeIds";

const MULTI_FILTER_KEYS: MultiFilterKey[] = ["brandIds", "colorIds", "sizeIds"];

function isMultiFilterKey(key: MenuKey): key is MultiFilterKey {
  return MULTI_FILTER_KEYS.includes(key as MultiFilterKey);
}

const FILTER_DETAIL_ROW_SCROLL =
  "flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

function getCategoryPath(categories: CategoryFilterOption[], id: string): string[] {
  const byId = new Map(categories.map((c) => [c.id, c] as const));
  const path: string[] = [];
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    path.unshift(cur);
    const node = byId.get(cur);
    cur = node?.parentId ?? null;
  }
  return path;
}

/** État de navigation feuille catégorie : ligne 2 = enfants du rayon, ligne 3 = affinage. */
function initCategorySheetBrowse(
  categories: CategoryFilterOption[],
  selectedId: string | null,
  hasChildren: (id: string) => boolean,
): { l1: string | null; l2: string | null } {
  if (!selectedId) return { l1: null, l2: null };
  const path = getCategoryPath(categories, selectedId);
  if (path.length === 0) return { l1: null, l2: null };

  const last = path[path.length - 1];
  if (path.length === 1) {
    if (hasChildren(last)) return { l1: last, l2: null };
    return { l1: null, l2: null };
  }
  const root = path[0];
  if (hasChildren(last)) {
    return { l1: root, l2: last };
  }
  if (path.length === 2) {
    return { l1: root, l2: null };
  }
  return { l1: root, l2: path[path.length - 2] };
}

function itemMatchesFilters(item: ShopCatalogItem, f: ShopFilters): boolean {
  if (f.categoryId && item.item_category_id !== f.categoryId) return false;
  if (f.sizeIds.length > 0 && (!item.item_size_id || !f.sizeIds.includes(item.item_size_id))) return false;
  if (f.brandIds.length > 0 && (!item.item_brand_id || !f.brandIds.includes(item.item_brand_id))) return false;
  if (f.colorIds.length > 0 && (!item.item_couleur_id || !f.colorIds.includes(item.item_couleur_id))) return false;
  if (f.materialId && item.item_materiaux_id !== f.materialId) return false;
  if (f.conditionScore && (item.condition_score ?? "") !== f.conditionScore) return false;
  return true;
}

function isDefaultCatalogView(filters: ShopFilters, search: string, heartsOnly: boolean, disponiblesOnly: boolean, sortMode: SortMode) {
  const hasFilter =
    filters.categoryId !== null ||
    filters.materialId !== null ||
    filters.conditionScore !== null ||
    filters.brandIds.length > 0 ||
    filters.colorIds.length > 0 ||
    filters.sizeIds.length > 0;
  return search.trim() === "" && !heartsOnly && !disponiblesOnly && !hasFilter && sortMode === "recent";
}

function pickPseudoFrame(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return {
    color: PSEUDO_FRAME_COLORS[hash % PSEUDO_FRAME_COLORS.length],
    tag: PSEUDO_FRAME_TAGLINES[hash % PSEUDO_FRAME_TAGLINES.length],
  };
}

function FilterChipButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors",
        active ? filterChipActiveClass : filterChipInactiveClass,
      )}
    >
      <span className="max-w-[140px] truncate">{label}</span>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
    </button>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors",
        active ? filterChipActiveClass : filterChipInactiveClass,
      )}
    >
      {label}
    </button>
  );
}

/** Puce filtre feuille modale : rangée scrollable horizontale. */
function FilterDetailHChip({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "max-w-[min(200px,72vw)] shrink-0 truncate rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors",
        active ? filterChipActiveClass : filterChipInactiveClass,
      )}
    >
      {label}
    </button>
  );
}

export function ShopCatalog({
  initialItems,
  initialLikedItemIds,
  categories,
  sizes,
  brands,
  colors,
  materials,
}: ShopCatalogProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { itemIds: cartItemIds } = useActiveCartItemIds();

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [heartsOnly, setHeartsOnly] = useState(false);
  const [disponiblesOnly, setDisponiblesOnly] = useState(false);
  const [filters, setFilters] = useState<ShopFilters>(emptyFilters);
  const [modalFilters, setModalFilters] = useState<ShopFilters>(emptyFilters);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [modalFilterFamily, setModalFilterFamily] = useState<ModalFilterFamily>("category");
  const [modalCategoryBrowseParentId, setModalCategoryBrowseParentId] = useState<string | null>(null);
  /** Feuille modale « détail filtre » (type Uber) : tri ou un critère à la fois. */
  const [filterDetailSheet, setFilterDetailSheet] = useState<OpenPanelKey | null>(null);
  const [filterSheetDraft, setFilterSheetDraft] = useState<ShopFilters>(emptyFilters);
  const [sortSheetDraft, setSortSheetDraft] = useState<SortMode>("recent");
  const [categorySheetBrowseL1, setCategorySheetBrowseL1] = useState<string | null>(null);
  const [categorySheetBrowseL2, setCategorySheetBrowseL2] = useState<string | null>(null);
  const [sectionFocus, setSectionFocus] = useState<{ label: string; itemIds: string[] } | null>(null);
  const [availableVisibleCount, setAvailableVisibleCount] = useState(40);

  const [likedSet, setLikedSet] = useState(() => new Set(initialLikedItemIds));
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>({});
  const coverResolvedRef = useRef(new Set<string>());
  const filtersRef = useRef(filters);
  const sortModeRef = useRef(sortMode);
  filtersRef.current = filters;
  sortModeRef.current = sortMode;
  const searchHeaderRef = useRef<HTMLElement | null>(null);
  const [searchHeaderHeight, setSearchHeaderHeight] = useState(0);

  const optionsByKey: Record<MenuKey, FilterOption[]> = useMemo(
    () => ({
      categoryId: categories,
      sizeIds: sizes,
      brandIds: brands,
      colorIds: colors,
      materialId: materials,
      conditionScore: CONDITION_OPTIONS,
    }),
    [categories, sizes, brands, colors, materials],
  );

  const categoryRootOptions = useMemo(() => {
    const roots = categories.filter((c) => c.parentId == null);
    return roots.length > 0 ? roots : categories;
  }, [categories]);

  const categoryChildOptions = useMemo(() => {
    if (!modalCategoryBrowseParentId) return [];
    return categories
      .filter((c) => c.parentId === modalCategoryBrowseParentId)
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [categories, modalCategoryBrowseParentId]);

  const categoryHasChildren = useCallback(
    (id: string) => categories.some((c) => c.parentId === id),
    [categories],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialItems.filter((item) => {
      if (heartsOnly && !likedSet.has(item.id)) return false;
      if (disponiblesOnly && item.status !== "available") return false;
      if (!itemMatchesFilters(item, filters)) return false;
      if (!q) return true;
      const brand = (item.brand_label ?? "").toLowerCase();
      const title = item.title.toLowerCase();
      const desc = (item.description ?? "").toLowerCase();
      return title.includes(q) || desc.includes(q) || brand.includes(q);
    });
  }, [initialItems, search, heartsOnly, disponiblesOnly, filters, likedSet]);

  const sortedFilteredItems = useMemo(() => {
    const list = [...filteredItems];
    if (sortMode === "recent") return list;
    if (sortMode === "price_asc") {
      return list.sort((a, b) => {
        const pa = a.price_points;
        const pb = b.price_points;
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return pa - pb;
      });
    }
    return list.sort((a, b) => {
      const pa = a.price_points;
      const pb = b.price_points;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pb - pa;
    });
  }, [filteredItems, sortMode]);

  /** Vignettes encore sans URL alors qu’un chemin photo existe (chargement signé en cours). */
  const hasPendingCovers = useMemo(() => {
    for (const item of sortedFilteredItems) {
      if (!coverUrlById[item.id] && getFirstPhotoStoragePath(item.photos)) return true;
    }
    return false;
  }, [sortedFilteredItems, coverUrlById]);

  /** Ralentit légèrement le balayage quand l’attente s’allonge (effet type Uber). */
  const [shimmerSlowStep, setShimmerSlowStep] = useState(0);
  useEffect(() => {
    if (!hasPendingCovers) {
      startTransition(() => setShimmerSlowStep(0));
      return;
    }
    startTransition(() => setShimmerSlowStep(0));
    const id = window.setInterval(() => {
      setShimmerSlowStep((s) => Math.min(s + 1, 10));
    }, 3200);
    return () => clearInterval(id);
  }, [hasPendingCovers]);

  const shimmerDurationSec = 2.85 + shimmerSlowStep * 0.55;

  useLayoutEffect(() => {
    const el = searchHeaderRef.current;
    if (!el) return;
    const measure = () => setSearchHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const fromPending = readShopCatalogRestorePendingSnapshot();
    let snap: ShopCatalogSessionSnapshot | null = null;
    let scrollY: number | null = null;

    if (fromPending) {
      const c = consumeShopCatalogRestoreFromStorage();
      scrollY = c.scrollY;
      snap = fromPending;
    } else {
      const fb = takeShopCatalogStrictRemountFallback();
      if (fb) {
        snap = fb.snap;
        scrollY = fb.scrollY;
      }
    }

    if (!snap) return;

    /* Restauration session au retour router.back() : appliquer avant le premier paint sans flash. */
    /* eslint-disable react-hooks/set-state-in-effect -- synchronisation one-shot lecture sessionStorage */
    setSearch(snap.search);
    setSortMode(snap.sortMode === "price_asc" || snap.sortMode === "price_desc" ? snap.sortMode : "recent");
    setHeartsOnly(Boolean(snap.heartsOnly));
    setDisponiblesOnly(Boolean(snap.disponiblesOnly));
    setFilters({ ...emptyFilters, ...parseShopCatalogFilters(snap.filters) });
    /* eslint-enable react-hooks/set-state-in-effect */

    if (scrollY != null) {
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }

    if (fromPending) {
      stashShopCatalogRestoreForStrictRemount({ snap, scrollY });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await Promise.all(
        sortedFilteredItems.map(async (item) => {
          if (coverResolvedRef.current.has(item.id)) return null;
          const path = getFirstPhotoStoragePath(item.photos);
          if (!path) {
            coverResolvedRef.current.add(item.id);
            return null;
          }
          try {
            const url = await createSignedUrlForStoragePath(supabase, path, 60 * 60 * 24);
            if (!url) return null;
            return [item.id, url] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const updates: Record<string, string> = {};
      for (const row of rows) {
        if (!row) continue;
        const [id, url] = row;
        updates[id] = url;
        coverResolvedRef.current.add(id);
      }
      if (Object.keys(updates).length > 0) {
        setCoverUrlById((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sortedFilteredItems, supabase]);

  useEffect(() => {
    let cancelled = false;
    async function syncLikes() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("item_favorites")
        .select("item_id")
        .eq("user_id", user.id)
        .is("deleted_at", null);
      if (!cancelled && data) {
        setLikedSet(new Set(data.map((r: { item_id: string }) => r.item_id)));
      }
    }
    void syncLikes();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const openFilterModal = useCallback(() => {
    setSectionFocus(null);
    setModalFilters({ ...filters });
    setModalFilterFamily("category");
    setModalCategoryBrowseParentId(null);
    setFilterModalOpen(true);
    setFilterDetailSheet(null);
  }, [filters]);

  const selectModalFilterFamily = useCallback((id: ModalFilterFamily) => {
    setModalFilterFamily(id);
    setModalCategoryBrowseParentId(null);
  }, []);

  const openFilterDetailSheet = useCallback((key: MenuKey) => {
    setSectionFocus(null);
    setFilterModalOpen(false);
    setFilterDetailSheet((prev) => (prev === key ? null : key));
  }, []);

  const toggleSortSheet = useCallback(() => {
    setSectionFocus(null);
    setFilterModalOpen(false);
    setFilterDetailSheet((prev) => (prev === "sort" ? null : "sort"));
  }, []);

  const categoryChildrenOf = useCallback(
    (parentId: string) =>
      categories
        .filter((c) => c.parentId === parentId)
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [categories],
  );

  /* Snapshot brouillon à l’ouverture uniquement ; layout pour éviter un flash avant synchro. */
  useLayoutEffect(() => {
    if (!filterDetailSheet) return;
    if (filterDetailSheet === "sort") {
      setSortSheetDraft(sortModeRef.current);
      return;
    }
    setFilterSheetDraft({ ...filtersRef.current });
    if (filterDetailSheet === "categoryId") {
      const b = initCategorySheetBrowse(
        categories,
        filtersRef.current.categoryId,
        (id) => categories.some((c) => c.parentId === id),
      );
      setCategorySheetBrowseL1(b.l1);
      setCategorySheetBrowseL2(b.l2);
    } else {
      setCategorySheetBrowseL1(null);
      setCategorySheetBrowseL2(null);
    }
  }, [filterDetailSheet, categories]);

  const applyModal = useCallback(() => {
    setFilters({ ...modalFilters });
    setFilterModalOpen(false);
  }, [modalFilters]);

  const resetModalFilters = useCallback(() => {
    setModalFilters({ ...emptyFilters });
    setModalCategoryBrowseParentId(null);
    setModalFilterFamily("category");
  }, []);

  const applyFilterDetailSheet = useCallback(() => {
    if (filterDetailSheet === "sort") {
      setSortMode(sortSheetDraft);
    } else if (filterDetailSheet) {
      setFilters({ ...filterSheetDraft });
    }
    setFilterDetailSheet(null);
  }, [filterDetailSheet, filterSheetDraft, sortSheetDraft]);

  const resetFilterDetailSheet = useCallback(() => {
    if (!filterDetailSheet) return;
    if (filterDetailSheet === "sort") {
      setSortSheetDraft("recent");
      return;
    }
    if (filterDetailSheet === "categoryId") {
      setFilterSheetDraft((d) => ({ ...d, categoryId: null }));
      setCategorySheetBrowseL1(null);
      setCategorySheetBrowseL2(null);
      return;
    }
    if (isMultiFilterKey(filterDetailSheet)) {
      setFilterSheetDraft((d) => ({ ...d, [filterDetailSheet]: [] }));
      return;
    }
    setFilterSheetDraft((d) => ({ ...d, [filterDetailSheet]: null }));
  }, [filterDetailSheet]);

  const chipLabel = useCallback(
    (key: MenuKey) => {
      if (isMultiFilterKey(key)) {
        const ids = filters[key];
        if (ids.length === 0) return MENU_LABELS[key];
        const opts = optionsByKey[key];
        if (ids.length === 1) {
          const opt = opts.find((o) => o.id === ids[0]);
          return opt?.label ?? MENU_LABELS[key];
        }
        const unit = key === "brandIds" ? "marques" : key === "colorIds" ? "couleurs" : "tailles";
        return `${ids.length} ${unit}`;
      }
      const id = filters[key] as string | null;
      if (!id) return MENU_LABELS[key];
      const opt = optionsByKey[key].find((o) => o.id === id);
      return opt?.label ?? MENU_LABELS[key];
    },
    [filters, optionsByKey],
  );

  const modalLine2Title = useMemo(() => {
    if (modalFilterFamily === "category" && modalCategoryBrowseParentId) {
      const parent = categories.find((c) => c.id === modalCategoryBrowseParentId);
      return parent ? `${parent.label}` : "Sous-catégories";
    }
    if (modalFilterFamily === "category") return "Catégorie";
    if (modalFilterFamily === "brand") return "Marques";
    if (modalFilterFamily === "color") return "Couleurs";
    return "Tailles";
  }, [modalFilterFamily, modalCategoryBrowseParentId, categories]);

  const modalLine2 = useMemo(() => {
    switch (modalFilterFamily) {
      case "category": {
        if (modalCategoryBrowseParentId) {
          if (categoryChildOptions.length === 0) {
            return (
              <div className={FILTER_DETAIL_ROW_SCROLL}>
                <FilterModalRowChip
                  label="Tous"
                  active={modalFilters.categoryId === null}
                  onClick={() => {
                    setModalFilters((f) => ({ ...f, categoryId: null }));
                    setModalCategoryBrowseParentId(null);
                  }}
                />
                <span className="self-center px-1 text-sm text-zinc-500">Aucune sous-catégorie</span>
              </div>
            );
          }
          return (
            <div className={FILTER_DETAIL_ROW_SCROLL}>
              <FilterModalRowChip
                label="Tous"
                active={modalFilters.categoryId === null}
                onClick={() => {
                  setModalFilters((f) => ({ ...f, categoryId: null }));
                  setModalCategoryBrowseParentId(null);
                }}
              />
              {categoryChildOptions.map((c) => (
                <FilterModalRowChip
                  key={c.id}
                  label={c.label}
                  active={modalFilters.categoryId === c.id}
                  onClick={() => setModalFilters((f) => ({ ...f, categoryId: c.id }))}
                />
              ))}
            </div>
          );
        }
        return (
          <div className={FILTER_DETAIL_ROW_SCROLL}>
            <FilterModalRowChip
              label="Tous"
              active={modalFilters.categoryId === null}
              onClick={() => setModalFilters((f) => ({ ...f, categoryId: null }))}
            />
            {categoryRootOptions.map((c) => (
              <FilterModalRowChip
                key={c.id}
                label={c.label}
                active={modalFilters.categoryId === c.id}
                onClick={() => {
                  if (categoryHasChildren(c.id)) {
                    setModalCategoryBrowseParentId(c.id);
                    setModalFilters((f) => ({ ...f, categoryId: null }));
                  } else {
                    setModalFilters((f) => ({ ...f, categoryId: c.id }));
                  }
                }}
              />
            ))}
          </div>
        );
      }
      case "brand":
        return (
          <div className={FILTER_DETAIL_ROW_SCROLL}>
            <FilterModalRowChip
              label="Tous"
              active={modalFilters.brandIds.length === 0}
              onClick={() => setModalFilters((f) => ({ ...f, brandIds: [] }))}
            />
            {brands.map((c) => (
              <FilterModalRowChip
                key={c.id}
                label={c.label}
                active={modalFilters.brandIds.includes(c.id)}
                onClick={() =>
                  setModalFilters((f) => ({
                    ...f,
                    brandIds: f.brandIds.includes(c.id) ? f.brandIds.filter((x) => x !== c.id) : [...f.brandIds, c.id],
                  }))
                }
              />
            ))}
          </div>
        );
      case "color":
        return (
          <div className={FILTER_DETAIL_ROW_SCROLL}>
            <FilterModalRowChip
              label="Tous"
              active={modalFilters.colorIds.length === 0}
              onClick={() => setModalFilters((f) => ({ ...f, colorIds: [] }))}
            />
            {colors.map((c) => (
              <FilterModalRowChip
                key={c.id}
                label={c.label}
                active={modalFilters.colorIds.includes(c.id)}
                onClick={() =>
                  setModalFilters((f) => ({
                    ...f,
                    colorIds: f.colorIds.includes(c.id) ? f.colorIds.filter((x) => x !== c.id) : [...f.colorIds, c.id],
                  }))
                }
              />
            ))}
          </div>
        );
      case "size":
        return (
          <div className={FILTER_DETAIL_ROW_SCROLL}>
            <FilterModalRowChip
              label="Tous"
              active={modalFilters.sizeIds.length === 0}
              onClick={() => setModalFilters((f) => ({ ...f, sizeIds: [] }))}
            />
            {sizes.map((c) => (
              <FilterModalRowChip
                key={c.id}
                label={c.label}
                active={modalFilters.sizeIds.includes(c.id)}
                onClick={() =>
                  setModalFilters((f) => ({
                    ...f,
                    sizeIds: f.sizeIds.includes(c.id) ? f.sizeIds.filter((x) => x !== c.id) : [...f.sizeIds, c.id],
                  }))
                }
              />
            ))}
          </div>
        );
      default:
        return null;
    }
  }, [
    modalFilterFamily,
    modalCategoryBrowseParentId,
    modalFilters.categoryId,
    modalFilters.brandIds,
    modalFilters.colorIds,
    modalFilters.sizeIds,
    categoryChildOptions,
    categoryRootOptions,
    categoryHasChildren,
    brands,
    colors,
    sizes,
  ]);

  const inHubSectionsView =
    sectionFocus === null && isDefaultCatalogView(filters, search, heartsOnly, disponiblesOnly, sortMode);

  const pickSectionItems = useCallback(
    (start: number, count: number) => {
      if (initialItems.length === 0) return [] as ShopCatalogItem[];
      const out: ShopCatalogItem[] = [];
      for (let i = 0; i < Math.min(count, Math.max(count, initialItems.length)); i += 1) {
        out.push(initialItems[(start + i) % initialItems.length]);
      }
      return out;
    },
    [initialItems],
  );

  const visibleGridItems = useMemo(() => {
    if (!sectionFocus) return sortedFilteredItems;
    const allowed = new Set(sectionFocus.itemIds);
    return sortedFilteredItems.filter((item) => allowed.has(item.id));
  }, [sectionFocus, sortedFilteredItems]);

  const availableCatalogItems = useMemo(
    () => initialItems.filter((item) => item.status === "available" || item.status === "in_cart"),
    [initialItems],
  );
  const visibleAvailableCatalogItems = useMemo(
    () => availableCatalogItems.slice(0, availableVisibleCount),
    [availableCatalogItems, availableVisibleCount],
  );

  const likedItems = useMemo(
    () => initialItems.filter((item) => likedSet.has(item.id)),
    [initialItems, likedSet],
  );

  const topDemandItems = useMemo(() => {
    const withPrice = [...initialItems].sort((a, b) => Number(b.price_points ?? 0) - Number(a.price_points ?? 0));
    return withPrice;
  }, [initialItems]);

  const likelyItems = useMemo(() => {
    const byBrand = initialItems.filter((item) => item.item_brand_id && filters.brandIds.includes(item.item_brand_id));
    if (byBrand.length > 0) return byBrand;
    return initialItems;
  }, [initialItems, filters.brandIds]);

  const preferredBrandSections = useMemo(() => brands.slice(0, 8), [brands]);
  const luxeBrands = useMemo(() => brands.filter((b) => /chanel|dior|saint|louis|herm|celine|balen|givenchy/i.test(b.label)).slice(0, 8), [brands]);

  const supersPreteuses = useMemo(
    () => [
      { id: "super-1", label: "Mia", subtitle: "Paris" },
      { id: "super-2", label: "Nina", subtitle: "Lyon" },
      { id: "super-3", label: "Lea", subtitle: "Lille" },
      { id: "super-4", label: "Sarah", subtitle: "Bordeaux" },
      { id: "super-5", label: "Emma", subtitle: "Nantes" },
      { id: "super-6", label: "Iris", subtitle: "Marseille" },
    ],
    [],
  );

  const upsellCards = useMemo(
    () => [
      { id: "upsell-credits", title: "Crédits boost", subtitle: "Rechargez vos crédits pour débloquer plus de looks", href: "/wallet" },
      { id: "upsell-plus", title: "Passez à Segna Plus", subtitle: "Plus de prêts, plus de visibilité, plus vite", href: "/onboarding/subscription" },
      { id: "upsell-pro", title: "Mode vendeuse pro", subtitle: "Publiez en avant-première et convertissez mieux", href: "/home" },
    ],
    [],
  );

  const applyBrandFilterFromSection = useCallback((brandId: string) => {
    setFilters((prev) => ({ ...prev, brandIds: [brandId] }));
  }, []);

  const applyCategoryFilterFromSection = useCallback((categoryId: string) => {
    setFilters((prev) => ({ ...prev, categoryId }));
  }, []);

  return (
    <div className="min-h-0 bg-white text-zinc-900">
      {/* En-tête recherche : fixe, le reste défile en dessous. */}
      <header
        ref={searchHeaderRef}
        className="fixed left-0 right-0 top-0 z-40 flex justify-center bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
      >
        <div className="relative w-full max-w-[430px]">
          <label className="relative block">
            <span className="sr-only">Recherche catalogue</span>
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSectionFocus(null);
                setSearch(e.target.value);
              }}
              placeholder="Recherchez sur Segna"
              className="w-full rounded-full border border-zinc-200 bg-white py-3.5 pl-12 pr-12 text-[15px] text-zinc-800 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.08),0_1px_3px_-2px_rgba(0,0,0,0.05)] placeholder:text-zinc-400 focus:border-[#8B6A54]/45 focus:outline-none focus:ring-2 focus:ring-[#8B6A54]/20 focus:shadow-[0_4px_14px_-4px_rgba(91,48,35,0.1),0_2px_6px_-3px_rgba(0,0,0,0.06)]"
            />
          </label>
          <button
            type="button"
            onClick={toggleSortSheet}
            aria-label="Trier les résultats"
            aria-expanded={filterDetailSheet === "sort"}
            className={cn(
              "absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
              "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35",
              sortMode !== "recent" && "text-[#5E3023]",
              filterDetailSheet === "sort" && "bg-zinc-100 text-[#5E3023]",
            )}
          >
            <svg
              className="h-[22px] w-[22px] shrink-0"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path
                fill="currentColor"
                d="M20 7H4a1 1 0 0 1 0-2h16a1 1 0 0 1 0 2zm-2 5a1 1 0 0 0-1-1H7a1 1 0 0 0 0 2h10a1 1 0 0 0 1-1zm-3 6a1 1 0 0 0-1-1h-4a1 1 0 0 0 0 2h4a1 1 0 0 0 1-1z"
              />
            </svg>
          </button>
        </div>
      </header>

      <div
        className="min-h-0"
        style={{
          paddingTop:
            searchHeaderHeight > 0 ? searchHeaderHeight : "max(5.5rem, calc(env(safe-area-inset-top) + 4.25rem))",
        }}
      >
        {/* Filtres */}
        <div className="border-b border-zinc-200/70 bg-white text-zinc-900">
          <div className="flex items-stretch gap-2 px-2 py-2">
            <button
              type="button"
              onClick={openFilterModal}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-zinc-800 shadow-[inset_0_0_0_1px_#e4e4e7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35"
              aria-label="Ouvrir les filtres"
            >
              <SlidersHorizontal className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ToggleChip
                label="Disponibles"
                active={disponiblesOnly}
                onClick={() => setDisponiblesOnly((v) => !v)}
              />
              <ToggleChip
                label="Coups de cœurs"
                active={heartsOnly}
                onClick={() => setHeartsOnly((v) => !v)}
              />
              {(Object.keys(MENU_LABELS) as MenuKey[]).map((key) => (
                <FilterChipButton
                  key={key}
                  label={chipLabel(key)}
                  active={
                    isMultiFilterKey(key)
                      ? filters[key].length > 0 || filterDetailSheet === key
                      : filters[key] !== null || filterDetailSheet === key
                  }
                  onClick={() => openFilterDetailSheet(key)}
                />
              ))}
            </div>
          </div>
          <p className="px-4 pb-3 pt-1 text-sm text-zinc-500">
            Découvrez comment les résultats sont classés.{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={toggleSortSheet}
            >
              En savoir plus
            </button>
          </p>
        </div>

        {/* Contenu principal : hub sections (par défaut) ou grille filtrée */}
        <div className="bg-white px-3 pb-28 pt-4">
          {inHubSectionsView ? (
            <div className="-mx-3 divide-y-[1px] divide-zinc-200">
              <div className="px-3 pb-5 pt-2">
              <HubRail
                title="À découvrir sur Segna"
                items={pickSectionItems(0, 10)}
                cartItemIds={cartItemIds}
                searchState={{ search, sortMode, heartsOnly, disponiblesOnly, filters }}
                onOpenSection={(itemIds) => setSectionFocus({ label: "À découvrir sur Segna", itemIds })}
              />
              </div>
              <div className="px-3 py-5">
              <ItemRailTwoUp
                title="Pièces likées"
                items={likedItems.length > 0 ? likedItems : pickSectionItems(10, 8)}
                cartItemIds={cartItemIds}
                searchState={{ search, sortMode, heartsOnly, disponiblesOnly, filters }}
                onOpenSection={(itemIds) => setSectionFocus({ label: "Pièces likées", itemIds })}
              />
              </div>
              <div className="px-3 py-5">
              <section className="space-y-3">
                <div className="-mx-3 flex snap-x snap-mandatory scroll-pl-3 gap-3 overflow-x-auto px-0 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
                  {categoryRootOptions.map((cat) => {
                    const pseudo = pickPseudoFrame(`cat-${cat.id}`);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => applyCategoryFilterFromSection(cat.id)}
                        className="w-[90%] max-w-[410px] shrink-0 snap-start rounded-2xl text-left"
                      >
                        <div className={cn("aspect-[2.32] rounded-2xl bg-gradient-to-br p-4 text-zinc-900", pseudo.color)}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-700">{pseudo.tag}</p>
                          <p className="mt-3 text-[1.65rem] font-bold leading-tight text-zinc-900">{cat.label}</p>
                        </div>
                      </button>
                    );
                  })}
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
                </div>
              </section>
              </div>
              <div className="px-3 py-5">
              <ItemRailTwoUp
                title="Pièces susceptibles de vous plaire"
                items={(likelyItems.length > 0 ? likelyItems : pickSectionItems(4, 10)).slice(0, 10)}
                cartItemIds={cartItemIds}
                searchState={{ search, sortMode, heartsOnly, disponiblesOnly, filters }}
                onOpenSection={(itemIds) => setSectionFocus({ label: "Pièces susceptibles de vous plaire", itemIds })}
              />
              </div>
              <div className="px-3 py-5">
              <ItemRailTwoUp
                title="Les pièces les plus demandées"
                items={(topDemandItems.length > 0 ? topDemandItems : pickSectionItems(8, 10)).slice(0, 10)}
                cartItemIds={cartItemIds}
                searchState={{ search, sortMode, heartsOnly, disponiblesOnly, filters }}
                onOpenSection={(itemIds) => setSectionFocus({ label: "Les pièces les plus demandées", itemIds })}
              />
              </div>

              <div className="px-3 py-5">
              <SectionHeader
                  title="Vos marques préférées"
                  onOpen={() => setSectionFocus({ label: "Vos marques préférées", itemIds: pickSectionItems(2, 12).map((i) => i.id) })}
                />
              <section className="space-y-3">
                <div className="-mx-3 flex gap-3 overflow-x-auto px-0 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="w-3 shrink-0" aria-hidden />
                  {preferredBrandSections.map((brand) => {
                    const pseudo = pickPseudoFrame(`brand-${brand.id}`);
                    return (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => applyBrandFilterFromSection(brand.id)}
                        className="w-[72%] max-w-[320px] shrink-0 rounded-2xl text-left"
                      >
                        <div className={cn("relative aspect-[1.65] rounded-2xl bg-gradient-to-br p-4 text-zinc-900", pseudo.color)}>
                          <p className="text-xs font-semibold uppercase tracking-wide">{pseudo.tag}</p>
                          <p className="mt-2 text-[2.25rem] font-bold leading-tight">{brand.label}</p>
                          <span
                            className="absolute bottom-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/92 text-zinc-800 shadow-sm"
                            title="Ajouter aux favoris"
                          >
                            <Heart className="h-5 w-5" aria-hidden />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  <div className="w-3 shrink-0" aria-hidden />
                </div>
              </section>
              </div>
              <div className="px-3 py-5">
              <section className="space-y-3">
                <div className="-mx-3 flex snap-x snap-mandatory scroll-pl-3 gap-3 overflow-x-auto px-0 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
                  {upsellCards.map((card) => {
                    const pseudo = pickPseudoFrame(card.id);
                    return (
                      <Link
                        key={card.id}
                        href={card.href}
                        className="w-[90%] max-w-[410px] shrink-0 snap-start rounded-2xl"
                      >
                        <div className={cn("aspect-[2.7] rounded-2xl bg-gradient-to-br px-4 py-1", pseudo.color)}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-700">{pseudo.tag}</p>
                          <p className="mt-2 text-[1.65rem] font-bold leading-tight text-zinc-900">{card.title}</p>
                          <p className="mt-1.5 text-[1rem] text-zinc-800">{card.subtitle}</p>
                        </div>
                      </Link>
                    );
                  })}
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
                </div>
              </section>
              </div>

              <div className="px-3 py-5">
              <HubRail
                title="Les bons coups"
                items={pickSectionItems(18, 10)}
                cartItemIds={cartItemIds}
                searchState={{ search, sortMode, heartsOnly, disponiblesOnly, filters }}
                onOpenSection={(itemIds) => setSectionFocus({ label: "Les bons coups", itemIds })}
              />
              </div>

              <div className="px-3 py-5">
              <section className="space-y-3">
                <SectionHeader
                  title="Nos supers prêteuses"
                  onOpen={() => setSectionFocus({ label: "Nos supers prêteuses", itemIds: pickSectionItems(6, 12).map((i) => i.id) })}
                />
                <div className="grid grid-cols-3 gap-3">
                  {supersPreteuses.map((p) => {
                    const pseudo = pickPseudoFrame(p.id);
                    return (
                      <div key={p.id} className="text-center">
                        <div className={cn("mx-auto mb-2 h-20 w-20 rounded-full bg-gradient-to-br", pseudo.color)} />
                        <p className="text-base font-semibold text-zinc-900">{p.label}</p>
                        <p className="text-sm text-zinc-500">{p.subtitle}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
              </div>

              <div className="px-3 py-5">
              <section className="space-y-3">
                <SectionHeader
                  title="Le luxe à la française"
                  onOpen={() => setSectionFocus({ label: "Le luxe à la française", itemIds: pickSectionItems(12, 12).map((i) => i.id) })}
                />
                <div className="-mx-3 flex gap-3 overflow-x-auto px-0 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="w-3 shrink-0" aria-hidden />
                  {(luxeBrands.length > 0 ? luxeBrands : brands.slice(0, 6)).map((brand) => {
                    const pseudo = pickPseudoFrame(`luxe-${brand.id}`);
                    return (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => applyBrandFilterFromSection(brand.id)}
                        className="w-[72%] max-w-[320px] shrink-0 rounded-2xl text-left"
                      >
                        <div className={cn("relative aspect-[1.65] rounded-2xl bg-gradient-to-br p-4 text-zinc-900", pseudo.color)}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-700">{pseudo.tag}</p>
                          <p className="mt-2 text-[2.25rem] font-bold leading-tight text-zinc-900">{brand.label}</p>
                          <span
                            className="absolute bottom-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/92 text-zinc-800 shadow-sm"
                            title="Ajouter aux favoris"
                          >
                            <Heart className="h-5 w-5" aria-hidden />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  <div className="w-3 shrink-0" aria-hidden />
                </div>
              </section>
              </div>

              <div className="px-3 py-5">
              <section className="space-y-3">
                <SectionHeader
                  title="Disponibles"
                  onOpen={() =>
                    setSectionFocus({
                      label: "Disponibles",
                      itemIds: availableCatalogItems.map((i) => i.id),
                    })
                  }
                />
                {visibleAvailableCatalogItems.length === 0 ? (
                  <p className="px-1 py-4 text-sm text-zinc-500">Aucune pièce disponible.</p>
                ) : (
                  <>
                    <ul className="grid grid-cols-2 gap-3">
                      {visibleAvailableCatalogItems.map((item) => {
                        const cover = coverUrlById[item.id];
                        const brandName = (item.brand_label ?? "").trim();
                        const price =
                          typeof item.price_points === "number" && !Number.isNaN(item.price_points)
                            ? `${item.price_points}`
                            : "—";
                        return (
                          <li key={`available-${item.id}`}>
                            <Link
                              href={`/items/${item.id}?from=shop`}
                              className="block"
                              onClick={() => {
                                persistShopCatalogStateForItemNavigation({
                                  search,
                                  sortMode,
                                  heartsOnly,
                                  disponiblesOnly,
                                  filters: { ...filters },
                                });
                              }}
                            >
                              <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-zinc-200">
                                {cover ? (
                                  <RemoteCoverThumb
                                    photoUrl={cover}
                                    frameClassName="absolute inset-0 h-full w-full rounded-2xl"
                                    className="rounded-2xl"
                                    coverStyle={{
                                      backgroundSize: "cover",
                                      backgroundPosition: "center",
                                      backgroundRepeat: "no-repeat",
                                    }}
                                  />
                                ) : (
                                  <SegnaSkeletonBlock
                                    className="h-full w-full"
                                    rounded="rounded-2xl"
                                    shimmerDurationSec={shimmerDurationSec}
                                  />
                                )}
                              </div>
                              <div className="mt-2 space-y-1">
                                <div className="flex items-start gap-2">
                                  <h3 className="line-clamp-2 min-w-0 flex-1 text-left text-[14px] font-semibold leading-snug text-zinc-900">
                                    {item.title}
                                  </h3>
                                  {cartItemIds.has(item.id) ? (
                                    <span
                                      className="mt-0.5 flex shrink-0 items-center justify-center text-[#5E3023]"
                                      title="Dans votre panier"
                                      role="img"
                                      aria-label="Dans votre panier"
                                    >
                                      <ShoppingCart className="h-4 w-4" strokeWidth={2} aria-hidden />
                                    </span>
                                  ) : (
                                    <span
                                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500 ring-1 ring-inset ring-black/5"
                                      title="Disponible"
                                      aria-label="Disponible"
                                      role="img"
                                    />
                                  )}
                                </div>
                                {brandName ? (
                                  <p className="text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                                    {brandName}
                                  </p>
                                ) : null}
                                <div className="flex items-center gap-1.5 text-[13px] text-zinc-700">
                                  <span className="tabular-nums font-medium">{price}</span>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={SEGNA_ICON} alt="" className="h-3.5 w-3.5 opacity-90" />
                                </div>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                    {availableVisibleCount < availableCatalogItems.length ? (
                      <button
                        type="button"
                        onClick={() => setAvailableVisibleCount((n) => Math.min(n + 40, availableCatalogItems.length))}
                        className="mt-4 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-800"
                      >
                        Afficher plus
                      </button>
                    ) : null}
                  </>
                )}
              </section>
              </div>

            </div>
          ) : visibleGridItems.length === 0 ? (
            <p className="px-1 py-10 text-center text-sm text-zinc-500">
              {sectionFocus ? `Aucune pièce disponible dans « ${sectionFocus.label} ».` : "Aucune pièce ne correspond à votre recherche."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {visibleGridItems.map((item) => {
                const available = item.status === "available";
                const cover = coverUrlById[item.id];
                const brandName = (item.brand_label ?? "").trim();
                const price =
                  typeof item.price_points === "number" && !Number.isNaN(item.price_points)
                    ? `${item.price_points}`
                    : "—";
                return (
                  <li key={item.id}>
                    <Link
                      href={`/items/${item.id}?from=shop`}
                      className="block"
                      onClick={() => {
                        persistShopCatalogStateForItemNavigation({
                          search,
                          sortMode,
                          heartsOnly,
                          disponiblesOnly,
                          filters: { ...filters },
                        });
                      }}
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-zinc-200">
                        {cover ? (
                          <RemoteCoverThumb
                            photoUrl={cover}
                            frameClassName="absolute inset-0 h-full w-full rounded-2xl"
                            className="rounded-2xl"
                            coverStyle={{
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                              backgroundRepeat: "no-repeat",
                            }}
                          />
                        ) : (
                          <SegnaSkeletonBlock
                            className="h-full w-full"
                            rounded="rounded-2xl"
                            shimmerDurationSec={shimmerDurationSec}
                          />
                        )}
                      </div>
                      <div className="mt-2 space-y-1">
                        <div className="flex items-start gap-2">
                          <h3 className="line-clamp-2 min-w-0 flex-1 text-left text-[14px] font-semibold leading-snug text-zinc-900">
                            {item.title}
                          </h3>
                          {cartItemIds.has(item.id) ? (
                            <span
                              className="mt-0.5 flex shrink-0 items-center justify-center text-[#5E3023]"
                              title="Dans votre panier"
                              role="img"
                              aria-label="Dans votre panier"
                            >
                              <ShoppingCart className="h-4 w-4" strokeWidth={2} aria-hidden />
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "mt-1.5 h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/5",
                                available ? "bg-sky-500" : "bg-zinc-300",
                              )}
                              title={available ? "Disponible" : "Indisponible"}
                              aria-label={available ? "Disponible" : "Indisponible"}
                              role="img"
                            />
                          )}
                        </div>
                        {brandName ? (
                          <p className="text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                            {brandName}
                          </p>
                        ) : null}
                        <div className="flex items-center gap-1.5 text-[13px] text-zinc-700">
                          <span className="tabular-nums font-medium">{price}</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={SEGNA_ICON} alt="" className="h-3.5 w-3.5 opacity-90" />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Modal filtres (feuille bas) */}
      {filterModalOpen ? (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50" role="presentation">
          <button
            type="button"
            className="min-h-0 flex-1 cursor-default border-0 bg-transparent p-0"
            aria-label="Fermer"
            onClick={() => setFilterModalOpen(false)}
          />
          <div
            className="max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-zinc-900 shadow-[0_-8px_40px_rgba(0,0,0,0.2)]"
            role="dialog"
            aria-labelledby="shop-filter-title"
          >
            <h2
              id="shop-filter-title"
              className="border-b border-zinc-200 px-1 pb-3 text-center text-lg font-bold text-zinc-900"
            >
              Filtrer par…
            </h2>

            <div className="pt-4">
              <p className="mb-2 text-sm font-semibold text-zinc-900">Type de filtre</p>
              <div className={FILTER_DETAIL_ROW_SCROLL}>
                {MODAL_FILTER_FAMILIES.map((f) => (
                  <FilterModalRowChip
                    key={f.id}
                    label={f.label}
                    active={modalFilterFamily === f.id}
                    onClick={() => selectModalFilterFamily(f.id)}
                  />
                ))}
              </div>
            </div>

            <div className="pt-5">
              <p className="mb-2 text-sm font-semibold text-zinc-900">{modalLine2Title}</p>
              {modalLine2}
            </div>

            <button
              type="button"
              onClick={applyModal}
              className="mt-8 w-full rounded-2xl bg-gradient-to-b from-[#5E3023] to-[#895737] py-4 text-center text-base font-semibold text-white shadow-sm"
            >
              Appliquer
            </button>
            <button
              type="button"
              onClick={resetModalFilters}
              className="mt-2 pb-1 pt-2 text-center text-sm font-semibold text-zinc-700"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      ) : null}

      {filterDetailSheet ? (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50" role="presentation">
          <button
            type="button"
            className="min-h-0 flex-1 cursor-default border-0 bg-transparent p-0"
            aria-label="Fermer"
            onClick={() => setFilterDetailSheet(null)}
          />
          <div
            className="flex max-h-[85dvh] flex-col rounded-t-3xl bg-white px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-zinc-900 shadow-[0_-8px_40px_rgba(0,0,0,0.2)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shop-filter-detail-title"
          >
            <h2
              id="shop-filter-detail-title"
              className="border-b border-zinc-200 px-1 pb-3 text-center text-lg font-bold text-zinc-900"
            >
              {filterDetailSheet === "sort" ? "Trier" : MENU_LABELS[filterDetailSheet]}
            </h2>

            <div className="min-h-0 max-h-[min(70dvh,520px)] flex-1 overflow-y-auto py-4">
              {filterDetailSheet === "sort" ? (
                <div className={FILTER_DETAIL_ROW_SCROLL}>
                  {SORT_OPTIONS.map(({ mode, label, description }) => (
                    <FilterDetailHChip
                      key={mode}
                      label={label}
                      title={description}
                      active={sortSheetDraft === mode}
                      onClick={() => setSortSheetDraft(mode)}
                    />
                  ))}
                </div>
              ) : filterDetailSheet === "categoryId" ? (
                <div className="space-y-4">
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Rayons
                    </p>
                    <div className={FILTER_DETAIL_ROW_SCROLL}>
                      <FilterDetailHChip
                        label="Tous"
                        active={
                          filterSheetDraft.categoryId === null &&
                          categorySheetBrowseL1 === null &&
                          categorySheetBrowseL2 === null
                        }
                        onClick={() => {
                          setFilterSheetDraft((d) => ({ ...d, categoryId: null }));
                          setCategorySheetBrowseL1(null);
                          setCategorySheetBrowseL2(null);
                        }}
                      />
                      {categoryRootOptions.map((r) => (
                        <FilterDetailHChip
                          key={r.id}
                          label={r.label}
                          active={
                            categorySheetBrowseL1 === r.id || filterSheetDraft.categoryId === r.id
                          }
                          onClick={() => {
                            if (categoryHasChildren(r.id)) {
                              setCategorySheetBrowseL1(r.id);
                              setCategorySheetBrowseL2(null);
                              setFilterSheetDraft((d) => ({ ...d, categoryId: null }));
                            } else {
                              setFilterSheetDraft((d) => ({ ...d, categoryId: r.id }));
                              setCategorySheetBrowseL1(null);
                              setCategorySheetBrowseL2(null);
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  {categorySheetBrowseL1 && categoryChildrenOf(categorySheetBrowseL1).length > 0 ? (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Sous-catégories
                      </p>
                      <div className={FILTER_DETAIL_ROW_SCROLL}>
                        <FilterDetailHChip
                          label="Tous"
                          active={filterSheetDraft.categoryId === null && categorySheetBrowseL1 === null}
                          onClick={() => {
                            setFilterSheetDraft((d) => ({ ...d, categoryId: null }));
                            setCategorySheetBrowseL1(null);
                            setCategorySheetBrowseL2(null);
                          }}
                        />
                        {categoryChildrenOf(categorySheetBrowseL1).map((c) => (
                          <FilterDetailHChip
                            key={c.id}
                            label={c.label}
                            active={
                              filterSheetDraft.categoryId === c.id || categorySheetBrowseL2 === c.id
                            }
                            onClick={() => {
                              if (categoryHasChildren(c.id)) {
                                setCategorySheetBrowseL2(c.id);
                                setFilterSheetDraft((d) => ({ ...d, categoryId: null }));
                              } else {
                                setFilterSheetDraft((d) => ({ ...d, categoryId: c.id }));
                                setCategorySheetBrowseL2(null);
                              }
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {categorySheetBrowseL2 && categoryChildrenOf(categorySheetBrowseL2).length > 0 ? (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Affiner
                      </p>
                      <div className={FILTER_DETAIL_ROW_SCROLL}>
                        <FilterDetailHChip
                          label="Tous"
                          active={
                            categorySheetBrowseL2 !== null &&
                            filterSheetDraft.categoryId === null
                          }
                          onClick={() => {
                            setFilterSheetDraft((d) => ({ ...d, categoryId: null }));
                            setCategorySheetBrowseL2(null);
                          }}
                        />
                        {categoryChildrenOf(categorySheetBrowseL2).map((g) => (
                          <FilterDetailHChip
                            key={g.id}
                            label={g.label}
                            active={filterSheetDraft.categoryId === g.id}
                            onClick={() => {
                              if (categoryHasChildren(g.id)) {
                                setCategorySheetBrowseL2(g.id);
                                setFilterSheetDraft((d) => ({ ...d, categoryId: null }));
                              } else {
                                setFilterSheetDraft((d) => ({ ...d, categoryId: g.id }));
                              }
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : isMultiFilterKey(filterDetailSheet) ? (
                <div className={FILTER_DETAIL_ROW_SCROLL}>
                  <FilterDetailHChip
                    label="Tous"
                    active={filterSheetDraft[filterDetailSheet].length === 0}
                    onClick={() =>
                      setFilterSheetDraft((d) => ({ ...d, [filterDetailSheet]: [] }))
                    }
                  />
                  {optionsByKey[filterDetailSheet].map((opt) => {
                    const selected = filterSheetDraft[filterDetailSheet].includes(opt.id);
                    return (
                      <FilterDetailHChip
                        key={opt.id}
                        label={opt.label}
                        active={selected}
                        onClick={() =>
                          setFilterSheetDraft((d) => ({
                            ...d,
                            [filterDetailSheet]: selected
                              ? d[filterDetailSheet].filter((x) => x !== opt.id)
                              : [...d[filterDetailSheet], opt.id],
                          }))
                        }
                      />
                    );
                  })}
                </div>
              ) : (
                <div className={FILTER_DETAIL_ROW_SCROLL}>
                  <FilterDetailHChip
                    label="Tous"
                    active={(filterSheetDraft[filterDetailSheet] as string | null) === null}
                    onClick={() =>
                      setFilterSheetDraft((d) => ({ ...d, [filterDetailSheet]: null }))
                    }
                  />
                  {optionsByKey[filterDetailSheet].map((opt) => (
                    <FilterDetailHChip
                      key={opt.id}
                      label={opt.label}
                      active={filterSheetDraft[filterDetailSheet] === opt.id}
                      onClick={() =>
                        setFilterSheetDraft((d) => ({ ...d, [filterDetailSheet]: opt.id }))
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={applyFilterDetailSheet}
              className="mt-2 w-full rounded-2xl bg-gradient-to-b from-[#5E3023] to-[#895737] py-4 text-center text-base font-semibold text-white shadow-sm"
            >
              Appliquer
            </button>
            <button
              type="button"
              onClick={resetFilterDetailSheet}
              className="mt-2 pb-1 pt-2 text-center text-sm font-semibold text-zinc-700"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Puces modal style Uber : actif noir / zinc-900. */
function FilterModalRowChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors",
        active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200/90",
      )}
    >
      {label}
    </button>
  );
}

function ItemRailTwoUp({
  title,
  items,
  cartItemIds,
  searchState,
  onOpenSection,
}: {
  title: string;
  items: ShopCatalogItem[];
  cartItemIds: Set<string>;
  searchState: {
    search: string;
    sortMode: SortMode;
    heartsOnly: boolean;
    disponiblesOnly: boolean;
    filters: ShopFilters;
  };
  onOpenSection: (itemIds: string[]) => void;
}) {
  const railItems = items.length > 0 ? items : [];
  if (railItems.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionHeader title={title} onOpen={() => onOpenSection(railItems.map((i) => i.id))} />
      <div className="-mx-3 flex gap-3 overflow-x-auto px-0 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-3 shrink-0" aria-hidden />
        {railItems.map((item, index) => {
          const available = item.status === "available";
          const brandName = (item.brand_label ?? "").trim();
          const price = typeof item.price_points === "number" && !Number.isNaN(item.price_points) ? `${item.price_points}` : "—";
          const pseudo = pickPseudoFrame(`${title}-${item.id}-${index}`);
          return (
            <Link
              key={`${title}-${item.id}-${index}`}
              href={`/items/${item.id}?from=shop`}
              className="w-[48%] min-w-[170px] shrink-0"
              onClick={() => {
                persistShopCatalogStateForItemNavigation({
                  search: searchState.search,
                  sortMode: searchState.sortMode,
                  heartsOnly: searchState.heartsOnly,
                  disponiblesOnly: searchState.disponiblesOnly,
                  filters: { ...searchState.filters },
                });
              }}
            >
              <div className={cn("mb-2 aspect-square rounded-2xl bg-gradient-to-br p-3", pseudo.color)} />
              <h3 className="line-clamp-2 text-left text-[14px] font-semibold leading-snug text-zinc-900">{item.title}</h3>
              <div className="mt-0.5 flex min-w-0 flex-nowrap items-center gap-1.5 whitespace-nowrap text-[14px] text-zinc-700">
                {cartItemIds.has(item.id) ? (
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5E3023]/12 text-[#5E3023]"
                    title="Dans votre panier"
                    role="img"
                    aria-label="Dans votre panier"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </span>
                ) : (
                  <span
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset ring-black/5",
                      available ? "bg-sky-500" : "bg-zinc-300",
                    )}
                    title={available ? "Disponible" : "Indisponible"}
                    aria-label={available ? "Disponible" : "Indisponible"}
                    role="img"
                  />
                )}
                <span className="text-[16px] font-semibold leading-none text-zinc-500">·</span>
                <span className="min-w-0 max-w-[8.5rem] truncate text-[14px] font-medium">{brandName || "Segna"}</span>
                <span className="text-[16px] font-semibold leading-none text-zinc-500">·</span>
                <span className="tabular-nums font-medium">{price}</span>
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={SEGNA_ICON} alt="" className="h-5 w-5 opacity-95" />
                </span>
              </div>
            </Link>
          );
        })}
        <div className="w-3 shrink-0" aria-hidden />
      </div>
    </section>
  );
}

function HubRail({
  title,
  items,
  cartItemIds,
  searchState,
  onOpenSection,
}: {
  title: string;
  items: ShopCatalogItem[];
  cartItemIds: Set<string>;
  searchState: {
    search: string;
    sortMode: SortMode;
    heartsOnly: boolean;
    disponiblesOnly: boolean;
    filters: ShopFilters;
  };
  onOpenSection: (itemIds: string[]) => void;
}) {
  const railItems = items.length > 0 ? items : [];
  if (railItems.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <SectionHeader title={title} onOpen={() => onOpenSection(railItems.map((i) => i.id))} />
      <div className="-mx-3 flex gap-3 overflow-x-auto px-0 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-3 shrink-0" aria-hidden />
        {railItems.map((item, index) => {
          const pseudo = pickPseudoFrame(`${title}-${item.id}-${index}`);
          const available = item.status === "available";
          const brandName = (item.brand_label ?? "").trim();
          const brandMeta = brandName || "Segna";
          const price = typeof item.price_points === "number" && !Number.isNaN(item.price_points) ? `${item.price_points}` : "—";
          return (
            <Link
              key={`${title}-${item.id}-${index}`}
              href={`/items/${item.id}?from=shop`}
              className="w-[72%] max-w-[320px] shrink-0"
              onClick={() => {
                persistShopCatalogStateForItemNavigation({
                  search: searchState.search,
                  sortMode: searchState.sortMode,
                  heartsOnly: searchState.heartsOnly,
                  disponiblesOnly: searchState.disponiblesOnly,
                  filters: { ...searchState.filters },
                });
              }}
            >
              <div className={cn("relative mb-2 aspect-[1.65] overflow-hidden rounded-2xl bg-gradient-to-br p-3 text-zinc-900", pseudo.color)}>
                <p className="text-xs font-semibold uppercase tracking-wide">{pseudo.tag}</p>
                <p className="mt-2 text-lg font-bold leading-tight">{item.title}</p>
                <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/92 text-zinc-800 shadow-sm"
                    title="Ajouter aux favoris"
                  >
                    <Heart className="h-4 w-4" aria-hidden />
                  </span>
                  {available ? (
                    <span
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-zinc-900 shadow-sm"
                      title="Ajouter au panier"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="space-y-0.5">
                <h3 className="line-clamp-1 text-left text-[14px] font-semibold leading-snug text-zinc-900">{item.title}</h3>
                <div className="flex min-w-0 flex-nowrap items-center gap-1.5 whitespace-nowrap text-[14px] text-zinc-700">
                {cartItemIds.has(item.id) ? (
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5E3023]/12 text-[#5E3023]"
                    title="Dans votre panier"
                    role="img"
                    aria-label="Dans votre panier"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </span>
                ) : (
                  <span
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset ring-black/5",
                      available ? "bg-sky-500" : "bg-zinc-300",
                    )}
                    title={available ? "Disponible" : "Indisponible"}
                    aria-label={available ? "Disponible" : "Indisponible"}
                    role="img"
                  />
                )}
                  <span className="text-[16px] font-semibold leading-none text-zinc-500">·</span>
                  <span className="min-w-0 max-w-[8.5rem] truncate text-[14px] font-medium">{brandMeta}</span>
                  <span className="text-[16px] font-semibold leading-none text-zinc-500">·</span>
                  <span className="tabular-nums font-medium">{price}</span>
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={SEGNA_ICON} alt="" className="h-5 w-5 opacity-95" />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
        <div className="w-3 shrink-0" aria-hidden />
      </div>
    </section>
  );
}

function SectionHeader({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className={cn(playfairDisplay.className, sectionTitleClass)}>{title}</h2>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Voir la sélection : ${title}`}
        className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35"
      >
        <ArrowRight className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
