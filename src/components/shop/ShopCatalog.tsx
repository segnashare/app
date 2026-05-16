"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronLeft, Heart, Plus, Search, SlidersHorizontal } from "lucide-react";
import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlForStoragePath, createSignedUrlsForStoragePaths, normalizeStorageObjectPath } from "@/lib/supabase/storage-resolve-signed-url";
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
import { CmsShopHubFramesProvider, type CmsShopHubFramesEnv } from "@/components/cms/CmsShopHubFramesContext";
import {
  CMS_SHOP_HUB_FRAME_OUTER_CLASS,
  SHOP_HUB_SPOTLIGHT_ITEM_RAIL_OUTER_CLASS,
  CmsFrameItem,
  ShopWideLinkCardBlock,
  useCmsHubFrameOuterOverride,
} from "@/components/cms/CmsSectionBlocks";
import { pickPseudoFrame } from "@/lib/cms/cms-pseudo-frame";
import type { RemoteCoverLoadState } from "@/components/ui/RemoteCoverThumb";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { useActiveCartItemIds } from "@/hooks/useActiveCartItemIds";
import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import type { CmsFramePayload, CmsFrameRow, CmsPhotoPosition } from "@/lib/cms/cms-types";
import { DEFAULT_BOUTIQUE_HUB_SECTION_ORDER, mergeBoutiqueHubOrder } from "@/lib/cms/boutique-hub-order";
import {
  buildShopDepartmentHubRail,
  departmentSlugForCategoryId,
} from "@/lib/shop/shop-department-categories";
import { mergeShopHubSectionDisplay, type ShopHubSectionSlug } from "@/lib/cms/shop-hub-sections";
import { cn } from "@/lib/utils/cn";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";

const montserratHubWideCard = segnaMontserrat;
const montserratPieceBold = segnaMontserrat;
const montserratPieceItalic = segnaMontserrat;
const montserratPieceMedium = segnaMontserrat;
const SHOP_GRID_INITIAL_VISIBLE_COUNT = 48;
const SHOP_GRID_LOAD_MORE_COUNT = 48;
const SHOP_INITIAL_COVER_WARM_COUNT = 32;
/** Limite les lots `createSignedUrls` (côté stockage / réseau) pour éviter des réponses tronquées. */
const SHOP_COVER_SIGN_PATH_CHUNK = 40;
/** Enchaîne des passes de signature dans le même effet (évite annulations en cascade si `coverUrlById` change). */
const SHOP_COVER_SIGN_MAX_PASSES = 8;

/** Chips filtres: base grise, active noire, plus plates et moins arrondies. */
const filterChipActiveClass = "border-transparent bg-zinc-950 text-white";
const filterChipInactiveClass = "border-transparent bg-zinc-100 text-zinc-900 hover:bg-zinc-200/90";

/** Cartes pièce boutique : titre gras, marque italique, ligne d’infos medium. */

export type SortMode = "recent" | "price_asc" | "price_desc";

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

export type ShopFilters = {
  categoryId: string | null;
  brandIds: string[];
  colorIds: string[];
  sizeIds: string[];
  materialId: string | null;
  conditionScore: string | null;
};

export const emptyShopCatalogFilters: ShopFilters = {
  categoryId: null,
  brandIds: [],
  colorIds: [],
  sizeIds: [],
  materialId: null,
  conditionScore: null,
};

export type ShopFeaturedLender = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Profil décoratif : pas de fiche /membre */
  isPlaceholder?: boolean;
  /** Avatar local / démo : affichage sans lien vers /membre/[id] */
  skipMemberProfileLink?: boolean;
};

type ShopCatalogProps = {
  initialItems: ShopCatalogItem[];
  initialLikedItemIds: string[];
  categories: CategoryFilterOption[];
  sizes: FilterOption[];
  brands: FilterOption[];
  colors: FilterOption[];
  materials: FilterOption[];
  /** Prêteuses réelles (serveur) : photos + lien /membre/[id] */
  featuredLenders?: ShopFeaturedLender[];
  /** Pièces du catalogue appartenant à ces prêteuses (vue « tout voir ») */
  featuredLenderSectionItemIds?: string[];
  mode?: "hub" | "section";
  /** Titre page section (/shop/[slug]) */
  sectionPageTitle?: string | null;
  /** Top 10 global par likes (rail « plus likées ») */
  initialMostLikedItems?: ShopCatalogItem[];
  /** CMS — capsules + éditos (section shop_home_capsules) */
  initialCmsShopFrames?: CmsFrameRow[];
  /** Config publiée `shop_home_capsules` (titre « À la une », masquer l’en-tête). */
  shopHomeCapsulesSectionDisplay?: CmsSectionPublishedDisplay;
  /** CMS — sections hub catalogue (titres, liens, frames pièce/catégorie/marque) */
  initialShopHubSections?: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>>;
  /** Ordre vertical des blocs hub (RPC `get_cms_boutique_section_order`). */
  boutiqueHubSectionOrder?: string[];
  /** Onboarding panier : attire l'oeil vers les + d'ajout au panier. */
  guideCartOnboarding?: boolean;
  /** Couvertures déjà résolues côté serveur (id → URL signée). */
  initialCoverUrlById?: Record<string, string>;
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

/** Filtre catégorie : accepte l’ID choisi et tout article dont la catégorie est dans le sous-arbre (ex. rayon = toutes sous-catégories). */
function itemCategoryMatchesFilter(
  itemCategoryId: string | null | undefined,
  filterCategoryId: string,
  categories: CategoryFilterOption[],
): boolean {
  if (!itemCategoryId) return false;
  const path = getCategoryPath(categories, itemCategoryId);
  return path.includes(filterCategoryId);
}

function itemMatchesFilters(item: ShopCatalogItem, f: ShopFilters, categories: CategoryFilterOption[]): boolean {
  if (f.categoryId) {
    if (!item.item_category_id) return false;
    if (!itemCategoryMatchesFilter(item.item_category_id, f.categoryId, categories)) return false;
  }
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

function pieceCardConditionLabel(item: ShopCatalogItem): string {
  const raw = item.condition_label?.trim();
  if (raw) return raw;
  const id = item.condition_score?.trim();
  if (id) return CONDITION_OPTIONS.find((o) => o.id === id)?.label ?? id;
  return "—";
}

function pieceCardSizeLine(sizeLabel: string | null | undefined): string {
  const t = sizeLabel?.trim();
  return t ? `Taille ${t}` : "Taille unique";
}

/** Style panneau gauche pour pièces mises en avant via CMS (À découvrir, bons coups, À la une…). */
export type ShopCmsPieceSpotlight = { bgHex: string; textColor: "white" | "black" };

export function parseCmsPieceSpotlightFromPayload(payload: CmsFramePayload): ShopCmsPieceSpotlight | null {
  const raw = typeof payload.item_spotlight_bg_hex === "string" ? payload.item_spotlight_bg_hex.trim() : "";
  if (!raw || !/^#?[0-9a-fA-F]{6}$/.test(raw)) return null;
  const bgHex = raw.startsWith("#") ? raw : `#${raw}`;
  const textColor = payload.item_spotlight_text_color === "black" ? "black" : "white";
  return { bgHex, textColor };
}

/** URL affichable pour la photo CMS du panneau droit (prioritaire sur la cover catalogue). */
export function itemSpotlightCoverUrlFromPayload(payload: CmsFramePayload): string | undefined {
  const img = payload.item_spotlight_image;
  if (!img || typeof img !== "object") return undefined;
  const u = typeof img.signed_url === "string" ? img.signed_url.trim() : "";
  if (u) return u;
  return undefined;
}

/** Cadrage panneau droit (zoom / offset %), même convention que les grandes cartes lien. */
export function itemSpotlightPhotoPositionFromPayload(payload: CmsFramePayload): CmsPhotoPosition {
  const img = payload.item_spotlight_image;
  if (!img?.position || img.position === null || typeof img.position !== "object") return null;
  return img.position;
}

/** Grille + rails catalogue automatiques : photo carrée, méta en dessous. */
type ShopPieceSquareCatalogCardProps = {
  item: ShopCatalogItem;
  cover: string | undefined;
  shimmerDurationSec: number;
  canAddToCart: boolean;
  inCart: boolean;
  liked: boolean;
  likeBusyIds: Set<string>;
  cartBusyIds: Set<string>;
  onToggleLike: (itemId: string) => Promise<void>;
  onToggleCart: (itemId: string) => Promise<void>;
  hideMetaUntilReady: boolean;
};

function ShopPieceSquareCatalogCard({
  item,
  cover,
  shimmerDurationSec,
  canAddToCart,
  inCart,
  liked,
  likeBusyIds,
  cartBusyIds,
  onToggleLike,
  onToggleCart,
  hideMetaUntilReady,
}: ShopPieceSquareCatalogCardProps) {
  const hasPhotoPath = Boolean(getFirstPhotoStoragePath(item.photos));
  const [loadState, setLoadState] = useState<RemoteCoverLoadState>(() =>
    !cover && !hasPhotoPath ? "ready" : "loading",
  );

  const imageReady = Boolean(cover) || loadState !== "loading" || !hasPhotoPath;
  const showMeta = !hideMetaUntilReady || imageReady;

  const brandName = (item.brand_label ?? "").trim();
  const price =
    typeof item.price_points === "number" && !Number.isNaN(item.price_points) ? `${item.price_points}` : "—";
  const sizeLine = pieceCardSizeLine(item.size_label);
  const condBit = pieceCardConditionLabel(item);
  const isBlueStatus = item.status === "available" || item.status === "in_cart";

  const actionBtnClass =
    "bg-white/95 text-zinc-900 shadow-sm ring-1 ring-black/10 backdrop-blur-[2px]";

  return (
    <div className="w-full">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-zinc-100 ring-1 ring-black/[0.06]">
        {cover ? (
          <RemoteCoverThumb
            photoUrl={cover}
            frameClassName="absolute inset-0 h-full w-full"
            className="h-full w-full"
            coverStyle={{
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
            onLoadStateChange={setLoadState}
          />
        ) : hasPhotoPath ? (
          <SegnaSkeletonBlock className="h-full w-full" rounded="rounded-none" shimmerDurationSec={shimmerDurationSec} />
        ) : (
          <div className="h-full w-full bg-zinc-200" aria-hidden />
        )}
        <div className="absolute bottom-2 right-2 z-10 flex gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onToggleLike(item.id);
            }}
            disabled={likeBusyIds.has(item.id)}
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-50",
              actionBtnClass,
            )}
            title="Ajouter aux favoris"
          >
            <Heart className={cn("h-4 w-4", liked && "fill-current")} aria-hidden />
          </button>
          {canAddToCart ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void onToggleCart(item.id);
              }}
              disabled={cartBusyIds.has(item.id)}
              className={cn(
                "segna-guidance-shimmer-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-50",
                actionBtnClass,
              )}
              title="Ajouter au panier"
            >
              <Plus className={cn("h-4 w-4 transition-transform duration-200", inCart && "rotate-45")} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      <div className={cn("mt-1 min-w-0 flex flex-col gap-0.5 px-0.5", !showMeta && "invisible")}>
        <div className="relative min-w-0">
          <h3
            className={cn(
              montserratPieceBold.className,
              "line-clamp-2 pr-5 text-left text-[14px] font-bold leading-snug text-zinc-900",
            )}
          >
            {item.title}
          </h3>
          <span
            className={cn(
              "absolute right-2 top-1.5 inline-flex h-1.5 w-1.5 rounded-full ring-1 ring-inset ring-black/10",
              isBlueStatus ? "bg-sky-400" : "bg-zinc-300",
            )}
            title={isBlueStatus ? "Disponible" : "Indisponible"}
            aria-label={isBlueStatus ? "Disponible" : "Indisponible"}
            role="img"
          />
        </div>
        {brandName ? (
          <p
            className={cn(
              montserratPieceItalic.className,
              "line-clamp-1 text-left text-[13px] italic text-zinc-600",
            )}
          >
            {brandName}
          </p>
        ) : null}
        <p
          className={cn(
            montserratPieceMedium.className,
            "flex flex-wrap items-center gap-x-1 text-left text-[11px] font-medium leading-snug text-zinc-600",
          )}
        >
          <span className="tabular-nums">{price}</span>
          <span className="text-zinc-400" aria-hidden>
            |
          </span>
          <span className="max-w-[40%] truncate">{sizeLine}</span>
          <span className="text-zinc-400" aria-hidden>
            |
          </span>
          <span className="min-w-0 max-w-full truncate">{condBit}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * Carte split coloré + image : réservée aux frames **CMS** pièce avec `item_spotlight_bg_hex` valide.
 */
type ShopPieceSplitCardProps = {
  item: ShopCatalogItem;
  cover: string | undefined;
  shimmerDurationSec: number;
  canAddToCart: boolean;
  inCart: boolean;
  liked: boolean;
  likeBusyIds: Set<string>;
  cartBusyIds: Set<string>;
  onToggleLike: (itemId: string) => Promise<void>;
  onToggleCart: (itemId: string) => Promise<void>;
  hideMetaUntilReady: boolean;
  spotlight: ShopCmsPieceSpotlight;
  /** Photo à droite = image CMS signée (pas la cover catalogue). */
  useCmsSpotlightImage?: boolean;
  spotlightPhotoPosition?: CmsPhotoPosition;
};

function ShopPieceSplitCard({
  item,
  cover,
  shimmerDurationSec,
  canAddToCart,
  inCart,
  liked,
  likeBusyIds,
  cartBusyIds,
  onToggleLike,
  onToggleCart,
  hideMetaUntilReady,
  spotlight,
  useCmsSpotlightImage = false,
  spotlightPhotoPosition = null,
}: ShopPieceSplitCardProps) {
  const hasPhotoPath = Boolean(getFirstPhotoStoragePath(item.photos));
  const [loadState, setLoadState] = useState<RemoteCoverLoadState>(() => (cover ? "loading" : "ready"));

  useEffect(() => {
    if (!cover) return;
    const rafId = window.requestAnimationFrame(() => setLoadState("loading"));
    return () => window.cancelAnimationFrame(rafId);
  }, [cover]);

  /** Tant que l’URL cover charge : squelette sur toute la frame (pas seulement la photo). */
  const imageReady = !cover || loadState !== "loading";
  const showMeta = !hideMetaUntilReady || imageReady;
  const showFullCardShimmer = Boolean(cover) && loadState === "loading";

  const hex = spotlight.bgHex;
  const useLightText = spotlight.textColor === "white";

  const brandName = (item.brand_label ?? "").trim();
  const price =
    typeof item.price_points === "number" && !Number.isNaN(item.price_points) ? `${item.price_points}` : "—";
  const sizeLine = pieceCardSizeLine(item.size_label);
  const condBit = pieceCardConditionLabel(item);

  const textMain = useLightText ? "text-white" : "text-zinc-900";
  const textSub = useLightText ? "text-white/90" : "text-zinc-700";
  const textMeta = useLightText ? "text-white/85" : "text-zinc-600";
  const sepClass = useLightText ? "text-white/55" : "text-zinc-400";

  const actionBtnClass = useLightText
    ? "bg-white text-zinc-900 shadow-sm ring-1 ring-black/10"
    : "bg-zinc-900 text-white shadow-sm ring-1 ring-black/10";

  const metaBlock = (
    <div className={cn("min-w-0 flex flex-col gap-0.5 pr-0.5", !showMeta && "invisible")}>
      <h3
        className={cn(
          montserratPieceBold.className,
          "line-clamp-2 text-left text-[clamp(14px,4vw,17px)] font-bold leading-snug",
          textMain,
        )}
      >
        {item.title}
      </h3>
      {brandName ? (
        <p
          className={cn(
            montserratPieceItalic.className,
            "line-clamp-1 text-left text-[clamp(13px,3.5vw,15px)] italic",
            textSub,
          )}
        >
          {brandName}
        </p>
      ) : null}
      <p
        className={cn(
          montserratPieceMedium.className,
          "flex flex-wrap items-center gap-x-1 text-left text-[10px] font-medium leading-snug min-[380px]:text-[11px]",
          textMeta,
        )}
      >
        <span className="tabular-nums">{price}</span>
        <span className={sepClass} aria-hidden>
          |
        </span>
        <span className="max-w-[42%] truncate">{sizeLine}</span>
        <span className={sepClass} aria-hidden>
          |
        </span>
        <span className="min-w-0 max-w-full truncate">{condBit}</span>
      </p>
    </div>
  );

  const actionRow = (
    <div className="mt-1.5 flex shrink-0 gap-2 self-start">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void onToggleLike(item.id);
        }}
        disabled={likeBusyIds.has(item.id)}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-50",
          actionBtnClass,
        )}
        title="Ajouter aux favoris"
      >
        <Heart className={cn("h-4 w-4", liked && "fill-current")} aria-hidden />
      </button>
      {canAddToCart ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void onToggleCart(item.id);
          }}
          disabled={cartBusyIds.has(item.id)}
          className={cn(
            "segna-guidance-shimmer-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-50",
            actionBtnClass,
          )}
          title="Ajouter au panier"
        >
          <Plus className={cn("h-4 w-4 transition-transform duration-200", inCart && "rotate-45")} aria-hidden />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="relative flex aspect-[2.12] min-h-[128px] w-full overflow-hidden rounded-2xl bg-zinc-200 ring-1 ring-black/[0.06]">
      <div
        className="flex min-w-0 w-[60%] shrink-0 flex-col pl-3.5 pr-2.5 pb-3 pt-3.5"
        style={{ backgroundColor: hex }}
      >
        <div className="min-h-0 min-w-0 flex-1">{metaBlock}</div>
        {actionRow}
      </div>
      <div className="relative h-full min-h-0 w-[40%] shrink-0 bg-zinc-50">
        {cover ? (
          <RemoteCoverThumb
            photoUrl={cover}
            frameClassName="absolute inset-0 h-full w-full"
            className="h-full w-full"
            suppressLoadSkeleton
            {...(useCmsSpotlightImage
              ? {
                  photoPosition: spotlightPhotoPosition ?? null,
                  photoCoverFill: true,
                }
              : {
                  coverStyle: {
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                  },
                })}
            onLoadStateChange={setLoadState}
          />
        ) : hasPhotoPath ? (
          <SegnaSkeletonBlock className="h-full w-full" rounded="rounded-none" shimmerDurationSec={shimmerDurationSec} />
        ) : (
          <div className="h-full w-full bg-zinc-100" aria-hidden />
        )}
        <div className="pointer-events-none absolute right-2 top-2 z-[4] sm:right-2.5 sm:top-2.5">
          <img
            src="/ressources/signature_segna.svg"
            alt=""
            width={120}
            height={40}
            className="h-5 w-auto max-w-[min(42vw,96px)] select-none object-contain opacity-[0.92] sm:h-6 sm:max-w-[104px]"
            aria-hidden
          />
        </div>
      </div>
      {showFullCardShimmer ? (
        <SegnaSkeletonBlock
          className="absolute inset-0 z-[20]"
          rounded="rounded-2xl"
          shimmerDurationSec={shimmerDurationSec}
        />
      ) : null}
    </div>
  );
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
  featuredLenders = [],
  featuredLenderSectionItemIds = [],
  mode = "hub",
  sectionPageTitle = null,
  initialMostLikedItems = [],
  initialCmsShopFrames = [],
  shopHomeCapsulesSectionDisplay = { hide_section_title: false, title: null },
  initialShopHubSections = {},
  boutiqueHubSectionOrder: boutiqueHubSectionOrderProp,
  guideCartOnboarding = false,
  initialCoverUrlById: initialCoverUrlByIdProp = {},
}: ShopCatalogProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { itemIds: cartItemIds, refresh: refreshCartItemIds } = useActiveCartItemIds();

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [heartsOnly, setHeartsOnly] = useState(false);
  const [disponiblesOnly, setDisponiblesOnly] = useState(false);
  const [filters, setFilters] = useState<ShopFilters>(emptyShopCatalogFilters);
  const [modalFilters, setModalFilters] = useState<ShopFilters>(emptyShopCatalogFilters);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [modalFilterFamily, setModalFilterFamily] = useState<ModalFilterFamily>("category");
  const [modalCategoryBrowseParentId, setModalCategoryBrowseParentId] = useState<string | null>(null);
  /** Feuille modale « détail filtre » (type Uber) : tri ou un critère à la fois. */
  const [filterDetailSheet, setFilterDetailSheet] = useState<OpenPanelKey | null>(null);
  const [filterSheetDraft, setFilterSheetDraft] = useState<ShopFilters>(emptyShopCatalogFilters);
  const [sortSheetDraft, setSortSheetDraft] = useState<SortMode>("recent");
  const [categorySheetBrowseL1, setCategorySheetBrowseL1] = useState<string | null>(null);
  const [categorySheetBrowseL2, setCategorySheetBrowseL2] = useState<string | null>(null);
  const [availableVisibleCount, setAvailableVisibleCount] = useState(40);
  const [gridVisibleCount, setGridVisibleCount] = useState(SHOP_GRID_INITIAL_VISIBLE_COUNT);

  const [likedSet, setLikedSet] = useState(() => new Set(initialLikedItemIds));
  const [localCartItemIds, setLocalCartItemIds] = useState<Set<string>>(() => new Set());
  const [likeBusyIds, setLikeBusyIds] = useState<Set<string>>(() => new Set());
  const [cartBusyIds, setCartBusyIds] = useState<Set<string>>(() => new Set());
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>(() => ({ ...initialCoverUrlByIdProp }));
  const coverUrlByIdRef = useRef<Record<string, string>>({});
  coverUrlByIdRef.current = coverUrlById;
  const filtersRef = useRef(filters);
  const sortModeRef = useRef(sortMode);
  filtersRef.current = filters;
  sortModeRef.current = sortMode;
  const searchHeaderRef = useRef<HTMLElement | null>(null);
  const [searchHeaderHeight, setSearchHeaderHeight] = useState(0);

  useEffect(() => {
    setLocalCartItemIds(new Set(cartItemIds));
  }, [cartItemIds]);

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
    const q = mode === "section" ? "" : search.trim().toLowerCase();
    return initialItems.filter((item) => {
      if (heartsOnly && !likedSet.has(item.id)) return false;
      if (disponiblesOnly && item.status !== "available") return false;
      if (!itemMatchesFilters(item, filters, categories)) return false;
      if (!q) return true;
      const brand = (item.brand_label ?? "").toLowerCase();
      const title = item.title.toLowerCase();
      const desc = (item.description ?? "").toLowerCase();
      return title.includes(q) || desc.includes(q) || brand.includes(q);
    });
  }, [mode, initialItems, search, heartsOnly, disponiblesOnly, filters, likedSet, categories]);

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

  const sortedFilteredItemsRef = useRef(sortedFilteredItems);
  sortedFilteredItemsRef.current = sortedFilteredItems;
  const gridVisibleCountRef = useRef(gridVisibleCount);
  gridVisibleCountRef.current = gridVisibleCount;
  const initialItemsRef = useRef(initialItems);
  initialItemsRef.current = initialItems;
  const initialMostLikedItemsRef = useRef(initialMostLikedItems);
  initialMostLikedItemsRef.current = initialMostLikedItems;

  /** Identifiant stable de la fenêtre catalogue visible (déclenche la résolution des couvertures quand la liste change). */
  const visibleCatalogIdsKey = useMemo(() => {
    const slice = sortedFilteredItems.slice(0, gridVisibleCount);
    return `${gridVisibleCount}|${initialItems.length}|${slice.map((i) => i.id).join(",")}`;
  }, [gridVisibleCount, sortedFilteredItems, initialItems.length]);

  useEffect(() => {
    setGridVisibleCount(SHOP_GRID_INITIAL_VISIBLE_COUNT);
  }, [search, sortMode, heartsOnly, disponiblesOnly, filters]);

  /** Vignettes encore sans URL alors qu’un chemin photo existe (chargement signé en cours). */
  const hasPendingCovers = useMemo(() => {
    for (const item of sortedFilteredItems.slice(0, gridVisibleCount)) {
      if (!coverUrlById[item.id] && getFirstPhotoStoragePath(item.photos)) return true;
    }
    return false;
  }, [sortedFilteredItems, gridVisibleCount, coverUrlById]);

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
  }, [mode, sectionPageTitle]);

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
    setSearch(snap.search);
    setSortMode(snap.sortMode === "price_asc" || snap.sortMode === "price_desc" ? snap.sortMode : "recent");
    setHeartsOnly(Boolean(snap.heartsOnly));
    setDisponiblesOnly(Boolean(snap.disponiblesOnly));
    setFilters({ ...emptyShopCatalogFilters, ...parseShopCatalogFilters(snap.filters) });

    if (scrollY != null) {
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }

    if (fromPending) {
      stashShopCatalogRestoreForStrictRemount({ snap, scrollY });
    }
  }, []);

  /* eslint-disable react-hooks/exhaustive-deps -- listes via refs ; déclenché surtout par `visibleCatalogIdsKey` (évite annulations à chaque update `coverUrlById`). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const noPathLocal = new Set<string>();
      const gc = gridVisibleCountRef.current;
      const sorted = sortedFilteredItemsRef.current;
      const initial = initialItemsRef.current;
      const mostLiked = initialMostLikedItemsRef.current;
      const baseCandidates = [
        ...sorted.slice(0, gc),
        ...mostLiked.slice(0, 10),
        ...initial.slice(0, SHOP_INITIAL_COVER_WARM_COUNT),
      ];
      /** Copie locale pour enchaîner les passes sans attendre le commit React. */
      let mergedCovers: Record<string, string> = { ...coverUrlByIdRef.current };

      for (let pass = 0; pass < SHOP_COVER_SIGN_MAX_PASSES; pass++) {
        const pathByItemId = new Map<string, string>();
        const paths: string[] = [];

        for (const item of baseCandidates) {
          if (mergedCovers[item.id]) continue;
          if (noPathLocal.has(item.id)) continue;
          const path = getFirstPhotoStoragePath(item.photos);
          if (!path) {
            noPathLocal.add(item.id);
            continue;
          }
          pathByItemId.set(item.id, path);
          paths.push(path);
        }

        if (pathByItemId.size === 0) break;

        const uniquePaths = [...new Set(paths)];
        const signedByPath = new Map<string, string>();
        for (let i = 0; i < uniquePaths.length; i += SHOP_COVER_SIGN_PATH_CHUNK) {
          const chunk = uniquePaths.slice(i, i + SHOP_COVER_SIGN_PATH_CHUNK);
          const partial = await createSignedUrlsForStoragePaths(supabase, chunk, 60 * 60 * 24);
          if (cancelled) return;
          for (const [k, v] of partial) {
            if (v) signedByPath.set(k, v);
          }
        }
        if (cancelled) return;

        const updates: Record<string, string> = {};
        for (const [id, path] of pathByItemId) {
          const normalized = normalizeStorageObjectPath(path);
          const url = signedByPath.get(path) ?? signedByPath.get(normalized);
          if (url) {
            updates[id] = url;
          }
        }

        const missingForFallback = [...pathByItemId.entries()].filter(([id]) => !updates[id]);
        for (const [id, path] of missingForFallback) {
          if (cancelled) return;
          const single = await createSignedUrlForStoragePath(supabase, path, 60 * 60 * 24);
          if (single) updates[id] = single;
        }

        if (Object.keys(updates).length === 0) break;

        mergedCovers = { ...mergedCovers, ...updates };
        setCoverUrlById((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, url] of Object.entries(updates)) {
            if (next[id] !== url) {
              next[id] = url;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleCatalogIdsKey, supabase]);

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

  const withLikeBusy = useCallback(async (itemId: string, action: () => Promise<void>) => {
    if (likeBusyIds.has(itemId)) return;
    setLikeBusyIds((s) => new Set([...s, itemId]));
    try {
      await action();
    } finally {
      setLikeBusyIds((s) => {
        const next = new Set(s);
        next.delete(itemId);
        return next;
      });
    }
  }, [likeBusyIds]);

  const withCartBusy = useCallback(async (itemId: string, action: () => Promise<void>) => {
    if (cartBusyIds.has(itemId)) return;
    setCartBusyIds((s) => new Set([...s, itemId]));
    try {
      await action();
    } finally {
      setCartBusyIds((s) => {
        const next = new Set(s);
        next.delete(itemId);
        return next;
      });
    }
  }, [cartBusyIds]);

  const getOpenCartId = useCallback(async (userId: string, opts?: { createIfMissing?: boolean }) => {
    const { data: existingCart } = await supabase
      .from("carts")
      .select("id,status")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", [...CART_STATUSES_OPEN])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingCart?.id) return existingCart.id as string;
    if (!opts?.createIfMissing) return null;
    const { data: createdCart } = await supabase
      .from("carts")
      .insert({ user_id: userId, status: "active" })
      .select("id")
      .single();
    return (createdCart?.id as string | undefined) ?? null;
  }, [supabase]);

  const handleToggleLike = useCallback(async (itemId: string) => {
    await withLikeBusy(itemId, async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const likedNow = likedSet.has(itemId);
      setLikedSet((prev) => {
        const next = new Set(prev);
        if (likedNow) next.delete(itemId);
        else next.add(itemId);
        return next;
      });

      if (likedNow) {
        await supabase
          .from("item_favorites")
          .update({ deleted_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("item_id", itemId)
          .is("deleted_at", null);
        return;
      }

      const { data: existingAny } = await supabase
        .from("item_favorites")
        .select("id,deleted_at")
        .eq("user_id", user.id)
        .eq("item_id", itemId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingAny?.id) {
        await supabase
          .from("item_favorites")
          .update({ deleted_at: null })
          .eq("id", existingAny.id);
      } else {
        await supabase
          .from("item_favorites")
          .insert({ user_id: user.id, item_id: itemId });
      }
    });
  }, [likedSet, supabase, withLikeBusy]);

  const handleToggleCart = useCallback(async (itemId: string) => {
    await withCartBusy(itemId, async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const inCartNow = localCartItemIds.has(itemId);
      setLocalCartItemIds((prev) => {
        const next = new Set(prev);
        if (inCartNow) next.delete(itemId);
        else next.add(itemId);
        return next;
      });

      if (inCartNow) {
        const cartId = await getOpenCartId(user.id, { createIfMissing: false });
        if (cartId) {
          await supabase
            .from("cart_items")
            .update({ deleted_at: new Date().toISOString() })
            .eq("cart_id", cartId)
            .eq("item_id", itemId)
            .is("deleted_at", null);
        } else {
          await supabase
            .from("cart_items")
            .update({ deleted_at: new Date().toISOString() })
            .eq("owner_user_id", user.id)
            .eq("item_id", itemId)
            .is("deleted_at", null);
        }
      } else {
        const cartId = await getOpenCartId(user.id, { createIfMissing: true });
        if (!cartId) return;

        const { data: existingActive } = await supabase
          .from("cart_items")
          .select("id")
          .eq("cart_id", cartId)
          .eq("item_id", itemId)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (existingActive?.id) return;

        const { data: existingDeleted } = await supabase
          .from("cart_items")
          .select("id")
          .eq("cart_id", cartId)
          .eq("item_id", itemId)
          .not("deleted_at", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingDeleted?.id) {
          await supabase
            .from("cart_items")
            .update({ deleted_at: null, status: "in_cart" })
            .eq("id", existingDeleted.id);
        } else {
          await supabase.from("cart_items").insert({
            cart_id: cartId,
            item_id: itemId,
            owner_user_id: user.id,
            status: "in_cart",
          });
        }
      }

      window.dispatchEvent(new CustomEvent("segna:cart-changed"));
      await refreshCartItemIds();
    });
  }, [getOpenCartId, localCartItemIds, refreshCartItemIds, supabase, withCartBusy]);

  const openFilterModal = useCallback(() => {
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
    setFilterModalOpen(false);
    setFilterDetailSheet((prev) => (prev === key ? null : key));
  }, []);

  const toggleSortSheet = useCallback(() => {
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
    setModalFilters({ ...emptyShopCatalogFilters });
    setModalCategoryBrowseParentId(null);
    setModalFilterFamily("category");
  }, []);

  /** Filtres catalogue (chips + Disponibles / Cœurs) — hors recherche et tri. */
  const hasActiveCatalogFilters = useMemo(() => {
    const f = filters;
    return (
      f.categoryId !== null ||
      f.materialId !== null ||
      f.conditionScore !== null ||
      f.brandIds.length > 0 ||
      f.colorIds.length > 0 ||
      f.sizeIds.length > 0 ||
      heartsOnly ||
      disponiblesOnly
    );
  }, [filters, heartsOnly, disponiblesOnly]);

  const clearAllCatalogFilters = useCallback(() => {
    setFilters({ ...emptyShopCatalogFilters });
    setHeartsOnly(false);
    setDisponiblesOnly(false);
    setFilterModalOpen(false);
    setFilterDetailSheet(null);
    setModalFilters({ ...emptyShopCatalogFilters });
    setModalCategoryBrowseParentId(null);
    setModalFilterFamily("category");
  }, []);

  const onSlidersFilterClick = useCallback(() => {
    if (hasActiveCatalogFilters) {
      clearAllCatalogFilters();
      return;
    }
    openFilterModal();
  }, [hasActiveCatalogFilters, clearAllCatalogFilters, openFilterModal]);

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
            const pid = modalCategoryBrowseParentId;
            return (
              <div className={FILTER_DETAIL_ROW_SCROLL}>
                <FilterModalRowChip
                  label="Toutes les sous-catégories"
                  active={modalFilters.categoryId === pid}
                  onClick={() => setModalFilters((f) => ({ ...f, categoryId: pid }))}
                />
                <span className="self-center px-1 text-sm text-zinc-500">Aucune sous-catégorie</span>
                <FilterModalRowChip
                  label="Tous les rayons"
                  active={modalFilters.categoryId === null}
                  onClick={() => {
                    setModalFilters((f) => ({ ...f, categoryId: null }));
                    setModalCategoryBrowseParentId(null);
                  }}
                />
              </div>
            );
          }
          return (
            <div className={FILTER_DETAIL_ROW_SCROLL}>
              <FilterModalRowChip
                label="Toutes les sous-catégories"
                active={modalFilters.categoryId === modalCategoryBrowseParentId}
                onClick={() => {
                  const parentId = modalCategoryBrowseParentId;
                  if (!parentId) return;
                  setModalFilters((f) => ({ ...f, categoryId: parentId }));
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
              <FilterModalRowChip
                label="Tous les rayons"
                active={modalFilters.categoryId === null}
                onClick={() => {
                  setModalFilters((f) => ({ ...f, categoryId: null }));
                  setModalCategoryBrowseParentId(null);
                }}
              />
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
                    setModalFilters((f) => ({ ...f, categoryId: c.id }));
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

  const showHub =
    mode === "hub" && isDefaultCatalogView(filters, search, heartsOnly, disponiblesOnly, sortMode);

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

  /** Même logique que pickSectionItems mais uniquement sur les pièces pas encore likées. */
  const pickSectionItemsNotLiked = useCallback(
    (start: number, count: number) => {
      const pool = initialItems.filter((item) => !likedSet.has(item.id));
      if (pool.length === 0) return [] as ShopCatalogItem[];
      const out: ShopCatalogItem[] = [];
      for (let i = 0; i < Math.min(count, Math.max(count, pool.length)); i += 1) {
        out.push(pool[(start + i) % pool.length]);
      }
      return out;
    },
    [initialItems, likedSet],
  );

  const visibleGridItems = useMemo(
    () => sortedFilteredItems.slice(0, gridVisibleCount),
    [sortedFilteredItems, gridVisibleCount],
  );

  const availableCatalogItems = useMemo(
    () => initialItems.filter((item) => item.status === "available" || item.status === "in_cart"),
    [initialItems],
  );
  const visibleAvailableCatalogItems = useMemo(
    () => availableCatalogItems.slice(0, availableVisibleCount),
    [availableCatalogItems, availableVisibleCount],
  );

  /** Favoris présents dans le catalogue courant, ordre serveur (created_at desc), max 10. */
  const likedItems = useMemo(() => {
    const orderIndex = new Map(initialLikedItemIds.map((id, i) => [id, i] as const));
    const candidates = initialItems.filter((item) => likedSet.has(item.id));
    candidates.sort((a, b) => {
      const ia = orderIndex.has(a.id) ? orderIndex.get(a.id)! : 1_000_000;
      const ib = orderIndex.has(b.id) ? orderIndex.get(b.id)! : 1_000_000;
      return ia - ib;
    });
    return candidates.slice(0, 10);
  }, [initialItems, likedSet, initialLikedItemIds]);

  const mostLikedRailItems = useMemo(() => {
    if (initialMostLikedItems.length > 0) return initialMostLikedItems.slice(0, 10);
    return pickSectionItems(8, 10);
  }, [initialMostLikedItems, pickSectionItems]);

  const likelyItems = useMemo(() => {
    const notLiked = (items: ShopCatalogItem[]) => items.filter((item) => !likedSet.has(item.id));
    const byBrand = initialItems.filter(
      (item) => item.item_brand_id && filters.brandIds.includes(item.item_brand_id),
    );
    const fromBrand = notLiked(byBrand);
    if (fromBrand.length > 0) return fromBrand;
    return notLiked(initialItems);
  }, [initialItems, filters.brandIds, likedSet]);

  const preferredBrandSections = useMemo(() => brands.slice(0, 8), [brands]);
  const luxeBrands = useMemo(() => brands.filter((b) => /chanel|dior|saint|louis|herm|celine|balen|givenchy/i.test(b.label)).slice(0, 8), [brands]);

  const boutiqueHubSectionOrder = useMemo(
    () =>
      boutiqueHubSectionOrderProp && boutiqueHubSectionOrderProp.length > 0
        ? mergeBoutiqueHubOrder(boutiqueHubSectionOrderProp)
        : [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER],
    [boutiqueHubSectionOrderProp],
  );

  const catalogItemById = useMemo(
    () => new Map(initialItems.map((i) => [i.id, i] as const)),
    [initialItems],
  );

  /** Rail « À la une » : refs catalogue + capsules `category_capsule`. */
  const cmsAtLaUneRows = useMemo(() => {
    const types = new Set<string>([
      "shop_category_ref",
      "shop_brand_ref",
      "shop_item_ref",
      "shop_link_card",
      "category_capsule",
    ]);
    return [...initialCmsShopFrames]
      .filter((r) => types.has(r.frame_type))
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  }, [initialCmsShopFrames]);

  const cmsHomePromoRows = useMemo(() => {
    const types = new Set<string>(["editorial_card", "offer_card", "promo_ad"]);
    return [...initialCmsShopFrames]
      .filter((r) => types.has(r.frame_type))
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  }, [initialCmsShopFrames]);

  const discoverHub = useMemo(() => {
    const conf = mergeShopHubSectionDisplay("discover", initialShopHubSections.discover?.config);
    const frames = initialShopHubSections.discover?.frames ?? [];
    const cmsItemRefCount = frames.filter((f) => f.frame_type === "shop_item_ref").length;
    const byId = new Map(initialItems.map((i) => [i.id, i] as const));
    const fromCms: {
      item: ShopCatalogItem;
      spotlight: ShopCmsPieceSpotlight | null;
      spotlightCoverUrl: string | undefined;
      spotlightPhotoPosition: CmsPhotoPosition;
    }[] = [];
    for (const f of frames) {
      if (f.frame_type !== "shop_item_ref") continue;
      const id = typeof f.payload.item_id === "string" ? f.payload.item_id.trim() : "";
      if (!id) continue;
      const it = byId.get(id);
      if (it)
        fromCms.push({
          item: it,
          spotlight: parseCmsPieceSpotlightFromPayload(f.payload),
          spotlightCoverUrl: itemSpotlightCoverUrlFromPayload(f.payload),
          spotlightPhotoPosition: itemSpotlightPhotoPositionFromPayload(f.payload),
        });
    }
    /** null = aucune config CMS publiée → repli catalogue ; [] = CMS actif mais rien à afficher */
    let railItems: ShopCatalogItem[] | null;
    let itemSpotlights: (ShopCmsPieceSpotlight | null)[] | null;
    let spotlightCoverUrls: (string | undefined)[] | null;
    let spotlightPhotoPositions: CmsPhotoPosition[] | null;
    if (fromCms.length > 0) {
      railItems = fromCms.map((x) => x.item);
      itemSpotlights = fromCms.map((x) => x.spotlight);
      spotlightCoverUrls = fromCms.map((x) => x.spotlightCoverUrl);
      spotlightPhotoPositions = fromCms.map((x) => x.spotlightPhotoPosition);
    } else if (cmsItemRefCount === 0) {
      railItems = null;
      itemSpotlights = null;
      spotlightCoverUrls = null;
      spotlightPhotoPositions = null;
    } else {
      railItems = [];
      itemSpotlights = [];
      spotlightCoverUrls = [];
      spotlightPhotoPositions = [];
    }
    return { conf, railItems, itemSpotlights, spotlightCoverUrls, spotlightPhotoPositions };
  }, [initialShopHubSections.discover, initialItems]);

  const dealsHub = useMemo(() => {
    const conf = mergeShopHubSectionDisplay("deals", initialShopHubSections.deals?.config);
    const frames = initialShopHubSections.deals?.frames ?? [];
    const cmsItemRefCount = frames.filter((f) => f.frame_type === "shop_item_ref").length;
    const byId = new Map(initialItems.map((i) => [i.id, i] as const));
    const fromCms: {
      item: ShopCatalogItem;
      spotlight: ShopCmsPieceSpotlight | null;
      spotlightCoverUrl: string | undefined;
      spotlightPhotoPosition: CmsPhotoPosition;
    }[] = [];
    for (const f of frames) {
      if (f.frame_type !== "shop_item_ref") continue;
      const id = typeof f.payload.item_id === "string" ? f.payload.item_id.trim() : "";
      if (!id) continue;
      const it = byId.get(id);
      if (it)
        fromCms.push({
          item: it,
          spotlight: parseCmsPieceSpotlightFromPayload(f.payload),
          spotlightCoverUrl: itemSpotlightCoverUrlFromPayload(f.payload),
          spotlightPhotoPosition: itemSpotlightPhotoPositionFromPayload(f.payload),
        });
    }
    let railItems: ShopCatalogItem[] | null;
    let itemSpotlights: (ShopCmsPieceSpotlight | null)[] | null;
    let spotlightCoverUrls: (string | undefined)[] | null;
    let spotlightPhotoPositions: CmsPhotoPosition[] | null;
    if (fromCms.length > 0) {
      railItems = fromCms.map((x) => x.item);
      itemSpotlights = fromCms.map((x) => x.spotlight);
      spotlightCoverUrls = fromCms.map((x) => x.spotlightCoverUrl);
      spotlightPhotoPositions = fromCms.map((x) => x.spotlightPhotoPosition);
    } else if (cmsItemRefCount === 0) {
      railItems = null;
      itemSpotlights = null;
      spotlightCoverUrls = null;
      spotlightPhotoPositions = null;
    } else {
      railItems = [];
      itemSpotlights = [];
      spotlightCoverUrls = [];
      spotlightPhotoPositions = [];
    }
    return { conf, railItems, itemSpotlights, spotlightCoverUrls, spotlightPhotoPositions };
  }, [initialShopHubSections.deals, initialItems]);

  const categoriesHub = useMemo(() => {
    const conf = mergeShopHubSectionDisplay("categories", initialShopHubSections.categories?.config);
    const frames = initialShopHubSections.categories?.frames ?? [];
    const departmentRail = buildShopDepartmentHubRail(categories, frames);
    return { conf, departmentRail };
  }, [initialShopHubSections.categories, categories]);

  const preferredBrandsHub = useMemo(() => {
    const conf = mergeShopHubSectionDisplay("preferredBrands", initialShopHubSections.preferredBrands?.config);
    const frames = [...(initialShopHubSections.preferredBrands?.frames ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
    );
    const cmsRefCount = frames.filter(
      (f) => f.frame_type === "shop_brand_ref" || f.frame_type === "shop_link_card",
    ).length;
    const byId = new Map(brands.map((b) => [b.id, b] as const));
    type Entry = { kind: "brand"; id: string; label: string } | { kind: "link"; frame: CmsFrameRow };
    const fromCms: Entry[] = [];
    for (const f of frames) {
      if (f.frame_type === "shop_link_card") {
        fromCms.push({ kind: "link", frame: f });
        continue;
      }
      if (f.frame_type !== "shop_brand_ref") continue;
      const id = typeof f.payload.brand_id === "string" ? f.payload.brand_id.trim() : "";
      if (!id) continue;
      const b = byId.get(id);
      if (b) fromCms.push({ kind: "brand", id: b.id, label: b.label });
    }
    let rail: Entry[] | null;
    if (fromCms.length > 0) rail = fromCms;
    else if (cmsRefCount === 0) rail = null;
    else rail = [];
    return { conf, rail };
  }, [initialShopHubSections.preferredBrands, brands]);

  const frenchHub = useMemo(() => {
    const conf = mergeShopHubSectionDisplay("french", initialShopHubSections.french?.config);
    const frames = [...(initialShopHubSections.french?.frames ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
    );
    const cmsRefCount = frames.filter(
      (f) => f.frame_type === "shop_brand_ref" || f.frame_type === "shop_link_card",
    ).length;
    const byId = new Map(brands.map((b) => [b.id, b] as const));
    type Entry = { kind: "brand"; id: string; label: string } | { kind: "link"; frame: CmsFrameRow };
    const fromCms: Entry[] = [];
    for (const f of frames) {
      if (f.frame_type === "shop_link_card") {
        fromCms.push({ kind: "link", frame: f });
        continue;
      }
      if (f.frame_type !== "shop_brand_ref") continue;
      const id = typeof f.payload.brand_id === "string" ? f.payload.brand_id.trim() : "";
      if (!id) continue;
      const b = byId.get(id);
      if (b) fromCms.push({ kind: "brand", id: b.id, label: b.label });
    }
    const fallbackSource = luxeBrands.length > 0 ? luxeBrands : brands.slice(0, 6);
    const fallback: Entry[] = fallbackSource.map((b) => ({ kind: "brand", id: b.id, label: b.label }));
    let list: Entry[];
    if (fromCms.length > 0) list = fromCms;
    else if (cmsRefCount === 0) list = fallback;
    else list = [];
    return { conf, list };
  }, [initialShopHubSections.french, brands, luxeBrands]);

  const applyBrandFilterFromSection = useCallback((brandId: string) => {
    setFilters((prev) => ({ ...prev, brandIds: [brandId] }));
  }, []);

  const applyCategoryFilterFromSection = useCallback((categoryId: string) => {
    setFilters((prev) => ({ ...prev, categoryId }));
  }, []);

  const cmsAtLaUneHubEnv = useMemo<CmsShopHubFramesEnv>(
    () => ({
      categories,
      brands,
      onCategoryFilter: applyCategoryFilterFromSection,
      onBrandFilter: applyBrandFilterFromSection,
      renderShopLinkCard: (row) => (
        <div className={cn(CMS_SHOP_HUB_FRAME_OUTER_CLASS, "self-start")}>
          <ShopWideLinkCardBlock
            payload={row.payload}
            aspectClassName="aspect-[2.32]"
            wrapperClassName="block w-full rounded-2xl"
            onNavigate={() =>
              persistShopCatalogStateForItemNavigation({
                search,
                sortMode,
                heartsOnly,
                disponiblesOnly,
                filters: { ...filters },
              })
            }
          />
        </div>
      ),
      renderShopItemRef: (row) => {
        const p = row.payload;
        const id = typeof p.item_id === "string" ? p.item_id.trim() : "";
        const item = id ? catalogItemById.get(id) : undefined;
        if (!item) return null;
        return (
          <ShopCapsuleItemRefFrame
            rowId={row.id}
            item={item}
            cover={coverUrlById[item.id]}
            spotlight={parseCmsPieceSpotlightFromPayload(p)}
            spotlightCoverUrl={itemSpotlightCoverUrlFromPayload(p)}
            spotlightPhotoPosition={itemSpotlightPhotoPositionFromPayload(p)}
            shimmerDurationSec={shimmerDurationSec}
            cartItemIds={localCartItemIds}
            likedSet={likedSet}
            likeBusyIds={likeBusyIds}
            cartBusyIds={cartBusyIds}
            onToggleLike={handleToggleLike}
            onToggleCart={handleToggleCart}
            searchState={{
              search,
              sortMode,
              heartsOnly,
              disponiblesOnly,
              filters,
            }}
          />
        );
      },
    }),
    [
      categories,
      brands,
      applyCategoryFilterFromSection,
      applyBrandFilterFromSection,
      catalogItemById,
      coverUrlById,
      shimmerDurationSec,
      localCartItemIds,
      likedSet,
      likeBusyIds,
      cartBusyIds,
      handleToggleLike,
      handleToggleCart,
      search,
      sortMode,
      heartsOnly,
      disponiblesOnly,
      filters,
    ],
  );

  function renderBoutiqueHubSection(sectionKey: string): ReactNode {
    const searchState = { search, sortMode, heartsOnly, disponiblesOnly, filters };
    switch (sectionKey) {
      case "shop_section_discover":
  return (
              <HubRail
            title={discoverHub.conf.title}
            hideSectionTitle={discoverHub.conf.hide_section_title}
            items={discoverHub.railItems === null ? pickSectionItems(0, 10) : discoverHub.railItems}
            itemSpotlights={
              discoverHub.railItems === null ? null : discoverHub.itemSpotlights
            }
            spotlightCoverUrls={
              discoverHub.railItems === null ? null : discoverHub.spotlightCoverUrls
            }
            spotlightPhotoPositions={
              discoverHub.railItems === null ? null : discoverHub.spotlightPhotoPositions
            }
            sectionHref={
              discoverHub.conf.show_more_arrow && discoverHub.conf.more_href.trim()
                ? discoverHub.conf.more_href.trim()
                : undefined
            }
                coverUrlById={coverUrlById}
                shimmerDurationSec={shimmerDurationSec}
                cartItemIds={localCartItemIds}
                likedSet={likedSet}
                likeBusyIds={likeBusyIds}
                cartBusyIds={cartBusyIds}
                onToggleLike={handleToggleLike}
                onToggleCart={handleToggleCart}
            searchState={searchState}
              />
        );
      case "shop_system_liked":
        return (
              <ItemRailTwoUp
                title="Pièces likées"
                items={likedItems}
                sectionHref="/shop/liked"
                coverUrlById={coverUrlById}
                shimmerDurationSec={shimmerDurationSec}
                cartItemIds={localCartItemIds}
                likedSet={likedSet}
                likeBusyIds={likeBusyIds}
                cartBusyIds={cartBusyIds}
                onToggleLike={handleToggleLike}
                onToggleCart={handleToggleCart}
            searchState={searchState}
          />
        );
      case "shop_section_categories": {
        if (categoriesHub.departmentRail.length === 0) return null;
        return (
              <section className="min-w-0 space-y-3">
            {!categoriesHub.conf.hide_section_title ? (
            <SectionHeader
              title={categoriesHub.conf.title}
              sectionHref={
                categoriesHub.conf.show_more_arrow && categoriesHub.conf.more_href.trim()
                  ? categoriesHub.conf.more_href.trim()
                  : undefined
              }
            />
            ) : null}
                <div className="flex w-full min-w-0 max-w-full flex-nowrap items-start snap-x snap-mandatory scroll-pl-3 gap-3 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
              {categoriesHub.departmentRail.map((dept) => {
                    const persist = () =>
                      persistShopCatalogStateForItemNavigation({
                        search,
                        sortMode,
                        heartsOnly,
                        disponiblesOnly,
                        filters: { ...filters },
                      });
                    if (dept.linkFrame) {
                    return (
                        <div
                          key={dept.linkFrame.id}
                          className={CMS_SHOP_HUB_FRAME_OUTER_CLASS}
                        >
                          <ShopWideLinkCardBlock
                            payload={dept.linkFrame.payload}
                            aspectClassName="aspect-[2.32]"
                            wrapperClassName="block w-full rounded-2xl"
                            onNavigate={persist}
                          />
                        </div>
                      );
                    }
                    const pseudo = pickPseudoFrame(`dept-${dept.slug}`);
                    return (
                      <Link
                        key={dept.slug}
                        href={`/shop/${dept.slug}`}
                        className={cn(CMS_SHOP_HUB_FRAME_OUTER_CLASS, "rounded-2xl text-left")}
                        onClick={persist}
                      >
                        <div
                          className={cn(
                            "flex aspect-[2.32] flex-col justify-start rounded-2xl bg-gradient-to-br p-4 text-white",
                            pseudo.color,
                          )}
                        >
                          <p
                            className={cn(
                              "text-[1.65rem] leading-tight",
                              montserratHubWideCard.className,
                            )}
                          >
                            {dept.label}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
                </div>
              </section>
        );
      }
      case "shop_system_for_you":
        return (
              <ItemRailTwoUp
                title="Pièces susceptibles de vous plaire"
                items={(likelyItems.length > 0 ? likelyItems : pickSectionItemsNotLiked(4, 10)).slice(0, 10)}
                sectionHref="/shop/for-you"
                coverUrlById={coverUrlById}
                shimmerDurationSec={shimmerDurationSec}
                cartItemIds={localCartItemIds}
                likedSet={likedSet}
                likeBusyIds={likeBusyIds}
                cartBusyIds={cartBusyIds}
                onToggleLike={handleToggleLike}
                onToggleCart={handleToggleCart}
            searchState={searchState}
              />
        );
      case "shop_system_popular":
        return (
              <ItemRailTwoUp
                title="Les pièces les plus likées"
                items={(mostLikedRailItems.length > 0 ? mostLikedRailItems : pickSectionItems(8, 10)).slice(0, 10)}
                sectionHref="/shop/popular"
                coverUrlById={coverUrlById}
                shimmerDurationSec={shimmerDurationSec}
                cartItemIds={localCartItemIds}
                likedSet={likedSet}
                likeBusyIds={likeBusyIds}
                cartBusyIds={cartBusyIds}
                onToggleLike={handleToggleLike}
                onToggleCart={handleToggleCart}
            searchState={searchState}
          />
        );
      case "shop_section_preferred_brands": {
        type BrandRailEntry =
          | { kind: "brand"; id: string; label: string }
          | { kind: "link"; frame: CmsFrameRow };
        const brandsForRail: BrandRailEntry[] =
          preferredBrandsHub.rail === null
            ? preferredBrandSections.map((b) => ({ kind: "brand", id: b.id, label: b.label }))
            : preferredBrandsHub.rail;
        if (brandsForRail.length === 0) return null;
        return (
          <section className="min-w-0 space-y-3">
            {!preferredBrandsHub.conf.hide_section_title ? (
            <SectionHeader
              title={preferredBrandsHub.conf.title}
              sectionHref={
                preferredBrandsHub.conf.show_more_arrow && preferredBrandsHub.conf.more_href.trim()
                  ? preferredBrandsHub.conf.more_href.trim()
                  : undefined
              }
            />
            ) : null}
                <div className="flex w-full min-w-0 max-w-full flex-nowrap items-start snap-x snap-mandatory scroll-pl-3 gap-3 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
                {brandsForRail.map((entry) => {
                  if (entry.kind === "link") {
                    return (
                      <ShopWideLinkCardBlock
                        key={entry.frame.id}
                        payload={entry.frame.payload}
                        aspectClassName="aspect-[2.32]"
                        wrapperClassName={cn(CMS_SHOP_HUB_FRAME_OUTER_CLASS, "self-start")}
                        onNavigate={() =>
                          persistShopCatalogStateForItemNavigation({
                            search,
                            sortMode,
                            heartsOnly,
                            disponiblesOnly,
                            filters: { ...filters },
                          })
                        }
                      />
                    );
                  }
                  const brand = entry;
                    const pseudo = pickPseudoFrame(`brand-${brand.id}`);
                    return (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => applyBrandFilterFromSection(brand.id)}
                        className="w-[72%] max-w-[320px] shrink-0 rounded-2xl text-left"
                      >
                      <div
                        className={cn(
                          "relative flex aspect-[1.65] flex-col justify-end rounded-2xl bg-gradient-to-br p-4 text-zinc-900",
                          pseudo.color,
                        )}
                      >
                        <p className="text-[2.25rem] font-bold leading-tight">{brand.label}</p>
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
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
                </div>
              </section>
        );
      }
      case "shop_home_capsules": {
        const capsulesCapTitle = shopHomeCapsulesSectionDisplay.title?.trim() || "À la une";
        const capsulesHideHeader = shopHomeCapsulesSectionDisplay.hide_section_title;
        const capsuleBlock =
          cmsAtLaUneRows.length > 0 ? (
            <div className="space-y-3">
              {!capsulesHideHeader ? (
                <SectionHeader title={capsulesCapTitle} showAction={false} />
              ) : null}
              <div
                className={cn(
                  "flex items-start gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  cmsAtLaUneRows.length === 1
                    ? "justify-center"
                    : "snap-x snap-mandatory scroll-pl-3",
                )}
              >
                {cmsAtLaUneRows.length === 1 ? null : <div className="w-3 shrink-0 snap-start" aria-hidden />}
                <CmsShopHubFramesProvider value={cmsAtLaUneHubEnv}>
                  {/* Enfants directs du flex : comme le panier (`CmsFrameItem` seul), pour une largeur de carte stable. */}
                  {cmsAtLaUneRows.map((row) => (
                    <CmsFrameItem key={row.id} row={row} />
                  ))}
                </CmsShopHubFramesProvider>
                {cmsAtLaUneRows.length === 1 ? null : <div className="w-3 shrink-0 snap-start" aria-hidden />}
              </div>
            </div>
          ) : null;
        const promoBlock =
          cmsHomePromoRows.length > 0 ? (
              <section className="space-y-3">
                <div
                  className={cn(
                    "flex items-start gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    cmsHomePromoRows.length === 1
                      ? "justify-center"
                      : "snap-x snap-mandatory scroll-pl-3",
                  )}
                >
                  {cmsHomePromoRows.length === 1 ? null : <div className="w-3 shrink-0 snap-start" aria-hidden />}
                  {cmsHomePromoRows.map((row) => (
                    <CmsFrameItem key={row.id} row={row} />
                  ))}
                  {cmsHomePromoRows.length === 1 ? null : <div className="w-3 shrink-0 snap-start" aria-hidden />}
                </div>
              </section>
          ) : null;
        if (!capsuleBlock && !promoBlock) return null;
        return (
          <div className="space-y-6">
            {capsuleBlock}
            {promoBlock}
              </div>
        );
      }
      case "shop_section_deals":
        return (
              <HubRail
            title={dealsHub.conf.title}
            hideSectionTitle={dealsHub.conf.hide_section_title}
            items={dealsHub.railItems === null ? pickSectionItems(18, 10) : dealsHub.railItems}
            itemSpotlights={dealsHub.railItems === null ? null : dealsHub.itemSpotlights}
            spotlightCoverUrls={dealsHub.railItems === null ? null : dealsHub.spotlightCoverUrls}
            spotlightPhotoPositions={
              dealsHub.railItems === null ? null : dealsHub.spotlightPhotoPositions
            }
            sectionHref={
              dealsHub.conf.show_more_arrow && dealsHub.conf.more_href.trim()
                ? dealsHub.conf.more_href.trim()
                : undefined
            }
                coverUrlById={coverUrlById}
                shimmerDurationSec={shimmerDurationSec}
                cartItemIds={localCartItemIds}
                likedSet={likedSet}
                likeBusyIds={likeBusyIds}
                cartBusyIds={cartBusyIds}
                onToggleLike={handleToggleLike}
                onToggleCart={handleToggleCart}
            searchState={searchState}
          />
        );
      case "shop_system_lenders":
        if (featuredLenders.length === 0) return null;
        return (
              <section className="space-y-3">
                <SectionHeader title="Nos supers prêteuses" sectionHref="/community" />
                <div className="grid grid-cols-3 gap-3">
                  {featuredLenders.map((p) => {
                    const pseudo = pickPseudoFrame(`lender-${p.userId}`);
                    const inner = (
                      <>
                        <div
                          className={cn(
                            "relative mx-auto mb-1.5 h-20 w-20 overflow-hidden rounded-full ring-1 ring-black/5",
                        p.isPlaceholder && !p.avatarUrl ? cn("bg-gradient-to-br", pseudo.color) : "bg-zinc-200",
                          )}
                        >
                          {p.avatarUrl ? (
                        <RemoteCoverThumb
                          photoUrl={p.avatarUrl}
                          frameClassName="h-full w-full rounded-full"
                          className="rounded-full"
                          coverStyle={{
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            backgroundRepeat: "no-repeat",
                          }}
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-xl font-semibold text-zinc-700">
                              {(p.displayName || "?").trim().slice(0, 1).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-1 text-base font-semibold text-zinc-900">{p.displayName}</p>
                      </>
                    );
                    if (p.isPlaceholder || p.skipMemberProfileLink) {
                      return (
                        <div
                          key={p.userId}
                          className="min-w-0 cursor-default text-center"
                      aria-label={p.isPlaceholder && !p.avatarUrl ? "Exemple de prêteuse" : p.displayName}
                        >
                          {inner}
                        </div>
                      );
                    }
                    return (
                      <Link
                        key={p.userId}
                        href={`/membre/${p.userId}`}
                        className="block min-w-0 text-center"
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
                        {inner}
                      </Link>
                    );
                  })}
                </div>
              </section>
        );
      case "shop_section_french":
        return (
              <section className="min-w-0 space-y-3">
            {!frenchHub.conf.hide_section_title ? (
            <SectionHeader
              title={frenchHub.conf.title}
              sectionHref={
                frenchHub.conf.show_more_arrow && frenchHub.conf.more_href.trim()
                  ? frenchHub.conf.more_href.trim()
                  : undefined
              }
            />
            ) : null}
                <div className="flex w-full min-w-0 max-w-full flex-nowrap items-start snap-x snap-mandatory scroll-pl-3 gap-3 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
              {frenchHub.list.map((entry) => {
                if (entry.kind === "link") {
                  return (
                    <ShopWideLinkCardBlock
                      key={entry.frame.id}
                      payload={entry.frame.payload}
                      aspectClassName="aspect-[2.32]"
                      wrapperClassName={cn(CMS_SHOP_HUB_FRAME_OUTER_CLASS, "self-start")}
                      onNavigate={() =>
                        persistShopCatalogStateForItemNavigation({
                          search,
                          sortMode,
                          heartsOnly,
                          disponiblesOnly,
                          filters: { ...filters },
                        })
                      }
                    />
                  );
                }
                const brand = entry;
                    const pseudo = pickPseudoFrame(`luxe-${brand.id}`);
                    return (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => applyBrandFilterFromSection(brand.id)}
                        className="w-[72%] max-w-[320px] shrink-0 rounded-2xl text-left"
                      >
                    <div
                      className={cn(
                        "relative flex aspect-[1.65] flex-col justify-end rounded-2xl bg-gradient-to-br p-4 text-zinc-900",
                        pseudo.color,
                      )}
                    >
                      <p className="text-[2.25rem] font-bold leading-tight text-zinc-900">{brand.label}</p>
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
                  <div className="w-3 shrink-0 snap-start" aria-hidden />
                </div>
              </section>
        );
      case "shop_system_available":
        return (
              <section className="space-y-3">
                <SectionHeader title="Disponibles" sectionHref="/shop/available" titleInset={false} />
                {visibleAvailableCatalogItems.length === 0 ? (
                  <p className="px-1 py-4 text-sm text-zinc-500">Aucune pièce disponible.</p>
                ) : (
                  <>
                    <ul className="grid grid-cols-2 gap-3">
                      {visibleAvailableCatalogItems.map((item) => {
                        const canAddToCart = item.status === "available" || item.status === "in_cart";
                        const inCart = localCartItemIds.has(item.id);
                        const liked = likedSet.has(item.id);
                        const cover = coverUrlById[item.id];
                        return (
                          <li key={`available-${item.id}`}>
                            <ShopCatalogGridItemCard
                              item={item}
                              cover={cover}
                              shimmerDurationSec={shimmerDurationSec}
                              canAddToCart={canAddToCart}
                              inCart={inCart}
                              liked={liked}
                              likeBusyIds={likeBusyIds}
                              cartBusyIds={cartBusyIds}
                              onToggleLike={handleToggleLike}
                              onToggleCart={handleToggleCart}
                              onNavigate={() =>
                                persistShopCatalogStateForItemNavigation({
                                  search,
                                  sortMode,
                                  heartsOnly,
                                  disponiblesOnly,
                                  filters: { ...filters },
                                })
                              }
                            />
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
        );
      default:
        return null;
    }
  }

  return (
    <div className={cn("min-h-0 bg-white text-zinc-900", guideCartOnboarding && "segna-guidance-shimmer-active")}>
      {/* En-tête recherche : fixe, le reste défile en dessous. */}
      <header
        ref={searchHeaderRef}
        className="fixed left-0 right-0 top-0 z-40 flex justify-center bg-white px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
      >
        <div className="w-full max-w-[430px]">
          {mode === "section" && sectionPageTitle ? (
            <div className="border-b border-zinc-200 pb-4">
              <div className="relative flex min-h-[52px] items-center justify-center">
                <Link
                  href="/shop"
                  className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-lg p-1 text-zinc-700 outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35"
                  aria-label="Retour à la boutique"
                >
                  <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
                </Link>
                <h1
                                    className={cn(
                    segnaPlayfairDisplay.className,
                    "mx-12 max-w-[min(100%,280px)] truncate text-center text-[20px] font-extrabold italic text-zinc-900 sm:max-w-[min(100%,340px)]",
                                    )}
                                  >
                  {sectionPageTitle}
                </h1>
                                    <button
                                      type="button"
                  onClick={toggleSortSheet}
                  aria-label="Trier les résultats"
                  aria-expanded={filterDetailSheet === "sort"}
                                      className={cn(
                    "absolute right-0 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
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
                              </div>
          ) : (
            <div className="space-y-3 pb-3">
              <div className="relative w-full">
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
                                </div>
          )}
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
          <div className="flex items-stretch gap-2 py-2 pl-2 pr-0">
                      <button
                        type="button"
              onClick={onSlidersFilterClick}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/25",
                hasActiveCatalogFilters
                  ? "bg-zinc-950 text-white shadow-none"
                  : "bg-white text-zinc-800 shadow-[inset_0_0_0_1px_#e4e4e7]",
              )}
              aria-label={hasActiveCatalogFilters ? "Réinitialiser les filtres" : "Ouvrir les filtres"}
                      >
              <SlidersHorizontal className="h-5 w-5" strokeWidth={2.25} />
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
        <div className={cn("min-w-0 bg-white pb-28 pt-4", showHub ? "px-0" : "px-3")}>
          {showHub ? (
            <div className="divide-y-[1px] divide-zinc-200">
              {boutiqueHubSectionOrder.map((sectionKey, index) => {
                const inner = renderBoutiqueHubSection(sectionKey);
                if (inner === null) return null;
                const padGridDisponibles = sectionKey === "shop_system_available";
                return (
                  <div
                    key={sectionKey}
                    className={cn(
                      "min-w-0",
                      padGridDisponibles ? "px-3" : "px-0",
                      index === 0 ? "pb-5 pt-2" : "py-5",
                    )}
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          ) : visibleGridItems.length === 0 ? (
            <p className="px-1 py-10 text-center text-sm text-zinc-500">
              {mode === "section" && sectionPageTitle
                ? `Aucune pièce dans « ${sectionPageTitle} » ne correspond à ces filtres.`
                : "Aucune pièce ne correspond à votre recherche."}
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3">
                {visibleGridItems.map((item) => {
                  const canAddToCart = item.status === "available" || item.status === "in_cart";
                  const inCart = localCartItemIds.has(item.id);
                  const liked = likedSet.has(item.id);
                  const cover = coverUrlById[item.id];
                  return (
                    <li key={item.id}>
                      <ShopCatalogGridItemCard
                        item={item}
                        cover={cover}
                        shimmerDurationSec={shimmerDurationSec}
                        canAddToCart={canAddToCart}
                        inCart={inCart}
                        liked={liked}
                        likeBusyIds={likeBusyIds}
                        cartBusyIds={cartBusyIds}
                        onToggleLike={handleToggleLike}
                        onToggleCart={handleToggleCart}
                        onNavigate={() =>
                          persistShopCatalogStateForItemNavigation({
                            search,
                            sortMode,
                            heartsOnly,
                            disponiblesOnly,
                            filters: { ...filters },
                          })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
              {gridVisibleCount < sortedFilteredItems.length ? (
                <button
                  type="button"
                  onClick={() => setGridVisibleCount((n) => Math.min(n + SHOP_GRID_LOAD_MORE_COUNT, sortedFilteredItems.length))}
                  className="mt-4 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-800"
                >
                  Afficher plus
                </button>
              ) : null}
            </>
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
            <h2 id="shop-filter-title" className={cn(segnaDialogTitleClass(), "border-b border-zinc-100 pb-3")}>
              Filtrer par…
            </h2>

            <div className="pt-4">
              <p className={cn(segnaDialogBodyClass("mb-2 font-semibold text-zinc-900"))}>Type de filtre</p>
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
              <p className={cn(segnaDialogBodyClass("mb-2 font-semibold text-zinc-900"))}>{modalLine2Title}</p>
              {modalLine2}
            </div>

            <button
              type="button"
              onClick={applyModal}
              className="mt-8 w-full rounded-2xl bg-zinc-900 py-4 text-center text-base font-semibold text-white shadow-sm"
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
        <div className="fixed inset-0 z-[60] flex flex-col justify-start bg-black/50" role="presentation">
          <div
            className="flex max-h-[85dvh] flex-col rounded-b-3xl bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-zinc-900 shadow-[0_8px_40px_rgba(0,0,0,0.2)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shop-filter-detail-title"
          >
            <h2
              id="shop-filter-detail-title"
              className={cn(segnaDialogTitleClass(), "border-b border-zinc-100 pb-3")}
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
                    <p className={cn(segnaDialogBodyClass("mb-1.5 font-semibold text-zinc-900"))}>Rayons</p>
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
                              setFilterSheetDraft((d) => ({ ...d, categoryId: r.id }));
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
                      <p className={cn(segnaDialogBodyClass("mb-1.5 font-semibold text-zinc-900"))}>Sous-catégories</p>
                      <div className={FILTER_DETAIL_ROW_SCROLL}>
                        <FilterDetailHChip
                          label="Toutes les sous-catégories"
                          active={
                            categorySheetBrowseL1 !== null &&
                            filterSheetDraft.categoryId === categorySheetBrowseL1 &&
                            categorySheetBrowseL2 === null
                          }
                          onClick={() => {
                            const l1 = categorySheetBrowseL1;
                            if (!l1) return;
                            setFilterSheetDraft((d) => ({ ...d, categoryId: l1 }));
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
                                setFilterSheetDraft((d) => ({ ...d, categoryId: c.id }));
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
                      <p className={cn(segnaDialogBodyClass("mb-1.5 font-semibold text-zinc-900"))}>Affiner</p>
                      <div className={FILTER_DETAIL_ROW_SCROLL}>
                        <FilterDetailHChip
                          label="Tous"
                          active={
                            categorySheetBrowseL2 !== null &&
                            filterSheetDraft.categoryId === categorySheetBrowseL2
                          }
                          onClick={() => {
                            const l2 = categorySheetBrowseL2;
                            if (!l2) return;
                            setFilterSheetDraft((d) => ({ ...d, categoryId: l2 }));
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
                                setFilterSheetDraft((d) => ({ ...d, categoryId: g.id }));
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
              className="mt-2 w-full rounded-2xl bg-zinc-900 py-4 text-center text-base font-semibold text-white shadow-sm"
            >
              Appliquer
            </button>
            <button
              type="button"
              onClick={resetFilterDetailSheet}
              className="mt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-center text-sm font-semibold text-zinc-700"
            >
              Réinitialiser
            </button>
          </div>
          <button
            type="button"
            className="min-h-0 flex-1 cursor-default border-0 bg-transparent p-0"
            aria-label="Fermer"
            onClick={() => setFilterDetailSheet(null)}
          />
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

/** Grille boutique : carte carrée (hors frames CMS mises en avant). */
function ShopCatalogGridItemCard({
  item,
  cover,
  shimmerDurationSec,
  canAddToCart,
  inCart,
  liked,
  likeBusyIds,
  cartBusyIds,
  onToggleLike,
  onToggleCart,
  onNavigate,
}: {
  item: ShopCatalogItem;
  cover: string | undefined;
  shimmerDurationSec: number;
  canAddToCart: boolean;
  inCart: boolean;
  liked: boolean;
  likeBusyIds: Set<string>;
  cartBusyIds: Set<string>;
  onToggleLike: (itemId: string) => Promise<void>;
  onToggleCart: (itemId: string) => Promise<void>;
  onNavigate: () => void;
}) {
  return (
    <Link href={`/items/${item.id}?from=shop`} className="block" onClick={onNavigate}>
      <ShopPieceSquareCatalogCard
        item={item}
        cover={cover}
        shimmerDurationSec={shimmerDurationSec}
        canAddToCart={canAddToCart}
        inCart={inCart}
        liked={liked}
        likeBusyIds={likeBusyIds}
        cartBusyIds={cartBusyIds}
        onToggleLike={onToggleLike}
        onToggleCart={onToggleCart}
        hideMetaUntilReady
      />
    </Link>
  );
}

function ItemRailTwoUpCard({
  item,
  cover,
  shimmerDurationSec,
  cartItemIds,
  likedSet,
  likeBusyIds,
  cartBusyIds,
  onToggleLike,
  onToggleCart,
  searchState,
  itemFromQuery = "shop",
  skipCatalogNavigationPersist = false,
}: {
  item: ShopCatalogItem;
  cover: string | undefined;
  shimmerDurationSec: number;
  cartItemIds: Set<string>;
  likedSet: Set<string>;
  likeBusyIds: Set<string>;
  cartBusyIds: Set<string>;
  onToggleLike: (itemId: string) => Promise<void>;
  onToggleCart: (itemId: string) => Promise<void>;
  searchState: {
    search: string;
    sortMode: SortMode;
    heartsOnly: boolean;
    disponiblesOnly: boolean;
    filters: ShopFilters;
  };
  itemFromQuery?: string;
  skipCatalogNavigationPersist?: boolean;
}) {
  const inCart = cartItemIds.has(item.id);
  const liked = likedSet.has(item.id);
  const canAddToCart = item.status === "available" || item.status === "in_cart";

  return (
    <Link
      href={`/items/${item.id}?from=${encodeURIComponent(itemFromQuery)}`}
      className="w-[48%] min-w-[170px] shrink-0"
      onClick={() => {
        if (skipCatalogNavigationPersist) return;
        persistShopCatalogStateForItemNavigation({
          search: searchState.search,
          sortMode: searchState.sortMode,
          heartsOnly: searchState.heartsOnly,
          disponiblesOnly: searchState.disponiblesOnly,
          filters: { ...searchState.filters },
        });
      }}
    >
      <ShopPieceSquareCatalogCard
        item={item}
        cover={cover}
        shimmerDurationSec={shimmerDurationSec}
        canAddToCart={canAddToCart}
        inCart={inCart}
        liked={liked}
        likeBusyIds={likeBusyIds}
        cartBusyIds={cartBusyIds}
        onToggleLike={onToggleLike}
        onToggleCart={onToggleCart}
        hideMetaUntilReady
      />
    </Link>
  );
}

/** Rail 2 colonnes (ex. « Susceptibles de vous plaire ») — réutilisable sur le panier via `itemFromQuery` / `skipCatalogNavigationPersist`. */
export function ItemRailTwoUp({
  title,
  items,
  sectionHref,
  coverUrlById,
  shimmerDurationSec,
  cartItemIds,
  likedSet,
  likeBusyIds,
  cartBusyIds,
  onToggleLike,
  onToggleCart,
  searchState,
  itemFromQuery = "shop",
  skipCatalogNavigationPersist = false,
}: {
  title: string;
  items: ShopCatalogItem[];
  sectionHref: string;
  coverUrlById: Record<string, string>;
  shimmerDurationSec: number;
  cartItemIds: Set<string>;
  likedSet: Set<string>;
  likeBusyIds: Set<string>;
  cartBusyIds: Set<string>;
  onToggleLike: (itemId: string) => Promise<void>;
  onToggleCart: (itemId: string) => Promise<void>;
  searchState: {
    search: string;
    sortMode: SortMode;
    heartsOnly: boolean;
    disponiblesOnly: boolean;
    filters: ShopFilters;
  };
  itemFromQuery?: string;
  skipCatalogNavigationPersist?: boolean;
}) {
  const railItems = items.length > 0 ? items : [];
  if (railItems.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionHeader title={title} sectionHref={sectionHref} />
      <div className="flex w-full min-w-0 max-w-full flex-nowrap gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-3 shrink-0" aria-hidden />
        {railItems.map((item, index) => (
          <ItemRailTwoUpCard
            key={`${title}-${item.id}-${index}`}
            item={item}
            cover={coverUrlById[item.id]}
            shimmerDurationSec={shimmerDurationSec}
            cartItemIds={cartItemIds}
            likedSet={likedSet}
            likeBusyIds={likeBusyIds}
            cartBusyIds={cartBusyIds}
            onToggleLike={onToggleLike}
            onToggleCart={onToggleCart}
            searchState={searchState}
            itemFromQuery={itemFromQuery}
            skipCatalogNavigationPersist={skipCatalogNavigationPersist}
          />
        ))}
        <div className="w-3 shrink-0" aria-hidden />
      </div>
    </section>
  );
}

export function ShopCapsuleItemRefFrame({
  rowId: _rowId,
  item,
  cover,
  spotlight,
  spotlightCoverUrl,
  spotlightPhotoPosition,
  shimmerDurationSec,
  cartItemIds,
  likedSet,
  likeBusyIds,
  cartBusyIds,
  onToggleLike,
  onToggleCart,
  searchState,
  /** @default "shop" — utiliser `"cart"` sur l’écran panier. */
  itemFromQuery = "shop",
  /** Panier / hors hub : ne pas enregistrer l’état filtres boutique pour le retour. */
  skipCatalogNavigationPersist = false,
}: {
  rowId: string;
  item: ShopCatalogItem;
  cover: string | undefined;
  spotlight: ShopCmsPieceSpotlight | null;
  /** Photo CMS panneau droit (si uploadée sur la frame). */
  spotlightCoverUrl?: string;
  spotlightPhotoPosition?: CmsPhotoPosition;
  shimmerDurationSec: number;
  cartItemIds: Set<string>;
  likedSet: Set<string>;
  likeBusyIds: Set<string>;
  cartBusyIds: Set<string>;
  onToggleLike: (itemId: string) => Promise<void>;
  onToggleCart: (itemId: string) => Promise<void>;
  searchState: {
    search: string;
    sortMode: SortMode;
    heartsOnly: boolean;
    disponiblesOnly: boolean;
    filters: ShopFilters;
  };
  itemFromQuery?: string;
  skipCatalogNavigationPersist?: boolean;
}) {
  const inCart = cartItemIds.has(item.id);
  const liked = likedSet.has(item.id);
  const canAddToCart = item.status === "available" || item.status === "in_cart";
  const cmsHubFrameOuterOverride = useCmsHubFrameOuterOverride();

  const rightCover = spotlight ? (spotlightCoverUrl ?? cover) : cover;
  const useCmsSpotlightImage = Boolean(spotlight && spotlightCoverUrl?.trim());

  const cardProps = {
    item,
    cover: rightCover,
    shimmerDurationSec,
    canAddToCart,
    inCart,
    liked,
    likeBusyIds,
    cartBusyIds,
    onToggleLike,
    onToggleCart,
    hideMetaUntilReady: true as const,
  };

  const itemRefLinkClassName =
    cmsHubFrameOuterOverride != null
      ? cn("snap-start", cmsHubFrameOuterOverride)
      : cn(
          "shrink-0 snap-start",
          spotlight ? SHOP_HUB_SPOTLIGHT_ITEM_RAIL_OUTER_CLASS : "w-[48%] min-w-[160px] max-w-[220px]",
        );

  return (
    <Link
      href={`/items/${item.id}?from=${encodeURIComponent(itemFromQuery)}`}
      className={itemRefLinkClassName}
      onClick={
        skipCatalogNavigationPersist
          ? undefined
          : () => {
              persistShopCatalogStateForItemNavigation({
                search: searchState.search,
                sortMode: searchState.sortMode,
                heartsOnly: searchState.heartsOnly,
                disponiblesOnly: searchState.disponiblesOnly,
                filters: { ...searchState.filters },
              });
            }
      }
    >
      {spotlight ? (
        <ShopPieceSplitCard
          {...cardProps}
          spotlight={spotlight}
          useCmsSpotlightImage={useCmsSpotlightImage}
          spotlightPhotoPosition={spotlightPhotoPosition}
        />
      ) : (
        <ShopPieceSquareCatalogCard {...cardProps} />
      )}
    </Link>
  );
}

function HubRail({
  title,
  hideSectionTitle,
  items,
  itemSpotlights,
  spotlightCoverUrls,
  spotlightPhotoPositions,
  sectionHref,
  coverUrlById,
  shimmerDurationSec,
  cartItemIds,
  likedSet,
  likeBusyIds,
  cartBusyIds,
  onToggleLike,
  onToggleCart,
  searchState,
}: {
  title: string;
  hideSectionTitle?: boolean;
  items: ShopCatalogItem[];
  /** Aligné sur `items` ; null / absent = cartes auto (repli catalogue). */
  itemSpotlights?: (ShopCmsPieceSpotlight | null)[] | null;
  /** Photo CMS panneau droit par entrée (même longueur que `items` quand CMS). */
  spotlightCoverUrls?: (string | undefined)[] | null;
  /** Cadrage CMS panneau droit (offset % / zoom), aligné sur `items`. */
  spotlightPhotoPositions?: CmsPhotoPosition[] | null;
  sectionHref?: string;
  coverUrlById: Record<string, string>;
  shimmerDurationSec: number;
  cartItemIds: Set<string>;
  likedSet: Set<string>;
  likeBusyIds: Set<string>;
  cartBusyIds: Set<string>;
  onToggleLike: (itemId: string) => Promise<void>;
  onToggleCart: (itemId: string) => Promise<void>;
  searchState: {
    search: string;
    sortMode: SortMode;
    heartsOnly: boolean;
    disponiblesOnly: boolean;
    filters: ShopFilters;
  };
}) {
  const railItems = items.length > 0 ? items : [];
  if (railItems.length === 0) return null;

  return (
    <section className="space-y-3">
      {!hideSectionTitle ? <SectionHeader title={title} sectionHref={sectionHref} /> : null}
      <div className="flex w-full min-w-0 max-w-full flex-nowrap items-start snap-x snap-mandatory scroll-pl-3 gap-3 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-3 shrink-0 snap-start" aria-hidden />
        {railItems.map((item, index) => {
          const inCart = cartItemIds.has(item.id);
          const liked = likedSet.has(item.id);
          const canAddToCart = item.status === "available" || item.status === "in_cart";
          const spotlight = itemSpotlights?.[index] ?? null;
          const catalogCover = coverUrlById[item.id];
          const cmsSpotUrl = spotlightCoverUrls?.[index]?.trim();
          const rightCover = spotlight ? (cmsSpotUrl || catalogCover) : catalogCover;
          const useCmsSpotlightImage = Boolean(spotlight && cmsSpotUrl);
          const railCardProps = {
            item,
            cover: rightCover,
            shimmerDurationSec,
            canAddToCart,
            inCart,
            liked,
            likeBusyIds,
            cartBusyIds,
            onToggleLike,
            onToggleCart,
            hideMetaUntilReady: true as const,
          };
          return (
            <Link
              key={`${title}-${item.id}-${index}`}
              href={`/items/${item.id}?from=shop`}
              className={cn(
                spotlight ? SHOP_HUB_SPOTLIGHT_ITEM_RAIL_OUTER_CLASS : "w-[48%] min-w-[160px] max-w-[220px] shrink-0",
              )}
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
              {spotlight ? (
                <ShopPieceSplitCard
                  {...railCardProps}
                  spotlight={spotlight}
                  useCmsSpotlightImage={useCmsSpotlightImage}
                  spotlightPhotoPosition={spotlightPhotoPositions?.[index] ?? null}
                />
              ) : (
                <ShopPieceSquareCatalogCard {...railCardProps} />
              )}
            </Link>
          );
        })}
        <div className="w-3 shrink-0 snap-start" aria-hidden />
      </div>
    </section>
  );
}

function SectionHeader({
  title,
  sectionHref,
  showAction = true,
  /** Faux si le parent applique déjà le padding horizontal (ex. section Disponibles). */
  titleInset = true,
}: {
  title: string;
  /** Page liste /shop/[slug] */
  sectionHref?: string;
  showAction?: boolean;
  titleInset?: boolean;
}) {
  /** Même hauteur de ligne qu’avec la flèche (`mt-1` + `h-10` → 2,75rem) pour un écart titre → frames identique avec ou sans lien. */
  return (
    <div className={cn("flex min-h-11 items-start justify-between gap-3", titleInset && "px-3")}>
      <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>{title}</h2>
      {showAction && sectionHref ? (
        <Link
          href={sectionHref}
          aria-label={`Voir la sélection : ${title}`}
          className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35"
        >
          <ArrowRight className="h-5 w-5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
