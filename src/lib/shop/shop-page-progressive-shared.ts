import type { ShopCatalogItem, ShopFeaturedLender, CategoryFilterOption } from "@/components/shop/ShopCatalog";
import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import type { ShopHubSectionSlug } from "@/lib/cms/shop-hub-sections";
import type { SizeFilterOption } from "@/lib/shop/size-filter-groups";

export type ShopCatalogFilterProps = {
  categories: CategoryFilterOption[];
  sizes: SizeFilterOption[];
  brands: { id: string; label: string }[];
  colors: { id: string; label: string }[];
  materials: { id: string; label: string }[];
};

export type ShopPageCatalogPayload = ShopCatalogFilterProps & {
  initialItems: ShopCatalogItem[];
  initialLikedItemIds: string[];
  initialMostLikedItems: ShopCatalogItem[];
  initialCoverUrlById: Record<string, string>;
  featuredLenders: ShopFeaturedLender[];
  featuredLenderSectionItemIds: string[];
  initialCmsShopFrames: CmsFrameRow[];
  shopHomeCapsulesSectionDisplay: CmsSectionPublishedDisplay;
  initialShopHubSections: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>>;
  boutiqueHubSectionOrder: string[];
  guideCartOnboarding: boolean;
  readyHubSectionKeys: string[];
};

export type ShopProgressiveChunk = {
  sectionKey: string;
  /** Sections marquées prêtes (chargement batch). */
  readySectionKeys?: string[];
  initialShopHubSections?: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>>;
  initialCmsShopFrames?: CmsFrameRow[];
  shopHomeCapsulesSectionDisplay?: CmsSectionPublishedDisplay;
  items?: ShopCatalogItem[];
  initialCoverUrlById?: Record<string, string>;
  featuredLenders?: ShopFeaturedLender[];
  featuredLenderSectionItemIds?: string[];
  initialMostLikedItems?: ShopCatalogItem[];
};

export function mergeShopProgressivePayload(
  base: ShopPageCatalogPayload,
  chunk: ShopProgressiveChunk,
): ShopPageCatalogPayload {
  const itemById = new Map(base.initialItems.map((item) => [item.id, item] as const));
  for (const item of chunk.items ?? []) {
    itemById.set(item.id, item);
  }

  const hubSections = { ...base.initialShopHubSections, ...chunk.initialShopHubSections };
  const cmsFrameById = new Map(base.initialCmsShopFrames.map((row) => [row.id, row] as const));
  for (const row of chunk.initialCmsShopFrames ?? []) {
    cmsFrameById.set(row.id, row);
  }

  const readyKeys = new Set(base.readyHubSectionKeys);
  if (chunk.readySectionKeys?.length) {
    for (const key of chunk.readySectionKeys) readyKeys.add(key);
  } else if (chunk.sectionKey !== "__remainder__" && chunk.sectionKey !== "__batch__") {
    readyKeys.add(chunk.sectionKey);
  }

  return {
    ...base,
    initialItems: [...itemById.values()],
    initialShopHubSections: hubSections,
    initialCmsShopFrames: [...cmsFrameById.values()],
    shopHomeCapsulesSectionDisplay:
      chunk.shopHomeCapsulesSectionDisplay ?? base.shopHomeCapsulesSectionDisplay,
    initialCoverUrlById: { ...base.initialCoverUrlById, ...chunk.initialCoverUrlById },
    featuredLenders: chunk.featuredLenders ?? base.featuredLenders,
    featuredLenderSectionItemIds:
      chunk.featuredLenderSectionItemIds ?? base.featuredLenderSectionItemIds,
    initialMostLikedItems: chunk.initialMostLikedItems ?? base.initialMostLikedItems,
    readyHubSectionKeys:
      chunk.sectionKey === "__remainder__" ? base.boutiqueHubSectionOrder : [...readyKeys],
  };
}
