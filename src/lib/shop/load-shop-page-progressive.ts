import type { ShopCatalogItem, ShopFeaturedLender } from "@/components/shop/ShopCatalog";
import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import type { ShopHubSectionSlug } from "@/lib/cms/shop-hub-sections";
import type {
  ShopCatalogFilterProps,
  ShopPageCatalogPayload,
  ShopProgressiveChunk,
} from "@/lib/shop/shop-page-progressive-shared";
export type { ShopCatalogFilterProps, ShopPageCatalogPayload, ShopProgressiveChunk } from "@/lib/shop/shop-page-progressive-shared";
export { mergeShopProgressivePayload } from "@/lib/shop/shop-page-progressive-shared";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import { isShopFeaturedRealMember } from "@/lib/shop/merge-featured-lenders";
import {
  fetchShopFeaturedLendersWithProfilePhotos,
  type FetchShopFeaturedLendersOptions,
} from "@/lib/shop/resolve-shop-featured-lenders-server";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import {
  fetchBoutiqueHubSectionOrderCached,
  fetchShopHomeCapsulesDisplayCached,
  fetchShopHomeCapsulesFramesCached,
  fetchShopHubSectionsBatchCached,
  loadShopBoutiqueFilterFacetResponses,
} from "@/lib/shop/shop-boutique-data-cache";
import {
  filterShopCmsBundleForOnboardingOffer,
  filterShopCmsFramesForOnboardingOffer,
} from "@/lib/shop/shop-page-cms-filters";
import { mapCategoryFilterRows, mapFilterRows, mapSizeFilterRows } from "@/lib/shop/shop-filter-options";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

/** Sections rendues immédiatement côté serveur (haut de page). */
export const SHOP_PAGE_INITIAL_SECTION_COUNT = 3;

/** Catalogue initial (repli API progressive). */
export const SHOP_INITIAL_CATALOG_LIMIT = 40;

/** Plafond URLs signées sur le chemin critique (API progressive). */
export const SHOP_CRITICAL_COVER_ITEM_CAP = 48;

/** Catalogue complet chargé avant affichage de la page. */
export const SHOP_FULL_CATALOG_LIMIT = 120;

const HUB_SECTION_KEY_TO_SLUG: Partial<Record<string, ShopHubSectionSlug>> = {
  shop_section_discover: "discover",
  shop_section_categories: "categories",
  shop_section_preferred_brands: "preferredBrands",
  shop_section_deals: "deals",
  shop_section_french: "french",
};

export type ShopPageLoadContext = {
  userId: string;
  supabase: SupabaseClient<Database>;
  catalogDb: StorageSignClient;
  isDemoMode: boolean;
  onboardingProcess: string | null;
  includedCreditsClaimed: boolean;
  guideCartOnboarding: boolean;
};

function parseCatalogItems(data: unknown): ShopCatalogItem[] {
  const payload = (data ?? { items: [] }) as { items?: ShopCatalogItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

function collectItemIdsFromHubBundles(
  bundles: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>>,
  cmsFrames: CmsFrameRow[],
): string[] {
  const ids = new Set<string>();
  for (const bundle of Object.values(bundles)) {
    for (const frame of bundle?.frames ?? []) {
      if (frame.frame_type !== "shop_item_ref") continue;
      const id = typeof frame.payload.item_id === "string" ? frame.payload.item_id.trim() : "";
      if (id) ids.add(id);
    }
  }
  for (const frame of cmsFrames) {
    if (frame.frame_type !== "shop_item_ref") continue;
    const id = typeof frame.payload.item_id === "string" ? frame.payload.item_id.trim() : "";
    if (id) ids.add(id);
  }
  return [...ids];
}

function filterHubBundle(bundle: CmsCatalogSectionBundle, ctx: ShopPageLoadContext): CmsCatalogSectionBundle {
  return filterShopCmsBundleForOnboardingOffer(bundle, ctx.onboardingProcess, ctx.includedCreditsClaimed);
}

async function loadHubDataForSectionKeys(
  sectionKeys: string[],
  ctx: ShopPageLoadContext,
): Promise<{
  hubSections: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>>;
  cmsShopFrames: CmsFrameRow[];
  shopHomeCapsulesSectionDisplay: CmsSectionPublishedDisplay;
}> {
  const slugsToLoad = new Set<ShopHubSectionSlug>();
  let loadCapsules = false;

  for (const key of sectionKeys) {
    const slug = HUB_SECTION_KEY_TO_SLUG[key];
    if (slug) slugsToLoad.add(slug);
    if (key === "shop_home_capsules") loadCapsules = true;
  }

  const hubSectionsRaw =
    slugsToLoad.size > 0 ? await fetchShopHubSectionsBatchCached([...slugsToLoad]) : {};
  const hubSections: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>> = {};
  for (const [slug, bundle] of Object.entries(hubSectionsRaw) as Array<
    [ShopHubSectionSlug, CmsCatalogSectionBundle]
  >) {
    hubSections[slug] = filterHubBundle(bundle, ctx);
  }

  let cmsShopFrames: CmsFrameRow[] = [];
  let shopHomeCapsulesSectionDisplay: CmsSectionPublishedDisplay = {
    hide_section_title: false,
    title: null,
  };

  if (loadCapsules) {
    const [frames, display] = await Promise.all([
      fetchShopHomeCapsulesFramesCached(),
      fetchShopHomeCapsulesDisplayCached(),
    ]);
    cmsShopFrames = filterShopCmsFramesForOnboardingOffer(
      frames,
      ctx.onboardingProcess,
      ctx.includedCreditsClaimed,
    );
    shopHomeCapsulesSectionDisplay = display;
  }

  return { hubSections, cmsShopFrames, shopHomeCapsulesSectionDisplay };
}

function dedupeCatalogItems(items: ShopCatalogItem[]): ShopCatalogItem[] {
  const seen = new Set<string>();
  const out: ShopCatalogItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

async function mergeCatalogWithRefs(
  catalogDb: StorageSignClient,
  baseItems: ShopCatalogItem[],
  extraIds: string[],
): Promise<ShopCatalogItem[]> {
  const inCatalog = new Set(baseItems.map((i) => i.id));
  const idsToFetch = extraIds.filter((id) => !inCatalog.has(id));
  const extra = idsToFetch.length > 0 ? await fetchShopCatalogItemsByIds(catalogDb, idsToFetch) : [];
  return dedupeCatalogItems([...baseItems, ...extra]);
}

function pickItemsForCoverSigning(
  items: ShopCatalogItem[],
  mostLiked: ShopCatalogItem[],
  cap: number,
): ShopCatalogItem[] {
  const out: ShopCatalogItem[] = [];
  const seen = new Set<string>();
  for (const item of [...mostLiked, ...items]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

async function loadFeaturedLendersBlock(ctx: ShopPageLoadContext): Promise<{
  featuredLenders: ShopFeaturedLender[];
  featuredLenderSectionItemIds: string[];
}> {
  const featuredLenderDb = ctx.catalogDb as unknown as FetchShopFeaturedLendersOptions["catalogDb"];
  const realFeaturedLenders = await fetchShopFeaturedLendersWithProfilePhotos({
    catalogDb: featuredLenderDb,
    maxMembers: 9,
    excludeUserId: ctx.userId,
  }).catch((err) => {
    console.error("[shop] featuredLenders failed:", err);
    return [] as ShopFeaturedLender[];
  });

  const featuredLenders = realFeaturedLenders.slice(0, 9);
  const featuredLenderUserIds = featuredLenders.filter(isShopFeaturedRealMember).map((l) => l.userId);

  let featuredLenderSectionItemIds: string[] = [];
  if (featuredLenderUserIds.length > 0) {
    const { data: itemRows } = await ctx.supabase
      .from("items")
      .select("id")
      .in("owner_user_id", featuredLenderUserIds)
      .is("deleted_at", null)
      .in("status", ["available", "in_cart", "reserved"])
      .limit(80);
    featuredLenderSectionItemIds = (itemRows ?? [])
      .map((r) => (r as { id?: string }).id)
      .filter((id): id is string => typeof id === "string");
  }

  return { featuredLenders, featuredLenderSectionItemIds };
}

async function signCoversForNewItems(
  catalogDb: StorageSignClient,
  items: ShopCatalogItem[],
  existingCovers: Record<string, string>,
): Promise<Record<string, string>> {
  const missing = items.filter((item) => !existingCovers[item.id]);
  if (missing.length === 0) return {};
  return resolveShopCatalogCoverUrlsServer(catalogDb, missing);
}

export async function loadShopPageCritical(ctx: ShopPageLoadContext): Promise<ShopPageCatalogPayload> {
  const catalogSb = ctx.catalogDb as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const boutiqueHubSectionOrder = await fetchBoutiqueHubSectionOrderCached();
  const criticalSectionKeys = boutiqueHubSectionOrder.slice(0, SHOP_PAGE_INITIAL_SECTION_COUNT);

  const [facetPack, favRes, mostLikedRes, catalogRes, hubPack] = await Promise.all([
    loadShopBoutiqueFilterFacetResponses(ctx.isDemoMode, ctx.supabase),
    ctx.supabase
      .from("item_favorites")
      .select("item_id")
      .eq("user_id", ctx.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    catalogSb.rpc("get_shop_most_liked_items", { p_limit: 10 }),
    catalogSb.rpc("get_shop_catalog_items", { p_limit: SHOP_INITIAL_CATALOG_LIMIT }),
    loadHubDataForSectionKeys(criticalSectionKeys, ctx),
  ]);

  const { catResFinal, sizeResFinal, brandResFinal, colResFinal, matResFinal } = facetPack;
  const initialMostLikedItems = parseCatalogItems(mostLikedRes.data);
  const catalogItems = parseCatalogItems(catalogRes.data);

  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  const hubItemIds = collectItemIdsFromHubBundles(hubPack.hubSections, hubPack.cmsShopFrames);
  const initialItems = await mergeCatalogWithRefs(ctx.catalogDb, catalogItems, [
    ...hubItemIds,
    ...initialLikedItemIds,
  ]);

  const itemsForCover = pickItemsForCoverSigning(
    initialItems,
    initialMostLikedItems,
    SHOP_CRITICAL_COVER_ITEM_CAP,
  );
  const initialCoverUrlById = await resolveShopCatalogCoverUrlsServer(ctx.catalogDb, itemsForCover);

  return {
    initialItems,
    initialLikedItemIds,
    initialMostLikedItems,
    initialCoverUrlById,
    featuredLenders: [],
    featuredLenderSectionItemIds: [],
    initialCmsShopFrames: hubPack.cmsShopFrames,
    shopHomeCapsulesSectionDisplay: hubPack.shopHomeCapsulesSectionDisplay,
    initialShopHubSections: hubPack.hubSections,
    boutiqueHubSectionOrder,
    guideCartOnboarding: ctx.guideCartOnboarding,
    readyHubSectionKeys: [...criticalSectionKeys],
    categories: mapCategoryFilterRows(catResFinal.data),
    sizes: mapSizeFilterRows(sizeResFinal.data),
    brands: mapFilterRows(brandResFinal.data),
    colors: mapFilterRows(colResFinal.data),
    materials: mapFilterRows(matResFinal.data),
  };
}

/** Charge la boutique complète côté serveur (sections CMS + couvertures) avant affichage. */
export async function loadShopPageFull(ctx: ShopPageLoadContext): Promise<ShopPageCatalogPayload> {
  const catalogSb = ctx.catalogDb as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const boutiqueHubSectionOrder = await fetchBoutiqueHubSectionOrderCached();

  const [facetPack, favRes, mostLikedRes, fullCatalogRes, hubPack, lendersBlock] = await Promise.all([
    loadShopBoutiqueFilterFacetResponses(ctx.isDemoMode, ctx.supabase),
    ctx.supabase
      .from("item_favorites")
      .select("item_id")
      .eq("user_id", ctx.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    catalogSb.rpc("get_shop_most_liked_items", { p_limit: 10 }),
    catalogSb.rpc("get_shop_catalog_items", { p_limit: SHOP_FULL_CATALOG_LIMIT }),
    loadHubDataForSectionKeys(boutiqueHubSectionOrder, ctx),
    loadFeaturedLendersBlock(ctx),
  ]);

  const { catResFinal, sizeResFinal, brandResFinal, colResFinal, matResFinal } = facetPack;
  const initialMostLikedItems = parseCatalogItems(mostLikedRes.data);
  const catalogItems = parseCatalogItems(fullCatalogRes.data);

  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  const hubItemIds = collectItemIdsFromHubBundles(hubPack.hubSections, hubPack.cmsShopFrames);
  const initialItems = await mergeCatalogWithRefs(ctx.catalogDb, catalogItems, [
    ...hubItemIds,
    ...initialLikedItemIds,
    ...lendersBlock.featuredLenderSectionItemIds,
  ]);

  const initialCoverUrlById = await resolveShopCatalogCoverUrlsServer(ctx.catalogDb, initialItems);

  return {
    initialItems,
    initialLikedItemIds,
    initialMostLikedItems,
    initialCoverUrlById,
    featuredLenders: lendersBlock.featuredLenders,
    featuredLenderSectionItemIds: lendersBlock.featuredLenderSectionItemIds,
    initialCmsShopFrames: hubPack.cmsShopFrames,
    shopHomeCapsulesSectionDisplay: hubPack.shopHomeCapsulesSectionDisplay,
    initialShopHubSections: hubPack.hubSections,
    boutiqueHubSectionOrder,
    guideCartOnboarding: ctx.guideCartOnboarding,
    readyHubSectionKeys: [...boutiqueHubSectionOrder],
    categories: mapCategoryFilterRows(catResFinal.data),
    sizes: mapSizeFilterRows(sizeResFinal.data),
    brands: mapFilterRows(brandResFinal.data),
    colors: mapFilterRows(colResFinal.data),
    materials: mapFilterRows(matResFinal.data),
  };
}

export async function loadShopPageSectionChunk(
  ctx: ShopPageLoadContext,
  sectionKey: string,
  existingItemIds: Set<string>,
  existingCovers: Record<string, string>,
): Promise<ShopProgressiveChunk> {
  const chunk: ShopProgressiveChunk = { sectionKey };

  if (sectionKey === "shop_system_lenders") {
    const { featuredLenders, featuredLenderSectionItemIds } = await loadFeaturedLendersBlock(ctx);
    chunk.featuredLenders = featuredLenders;
    chunk.featuredLenderSectionItemIds = featuredLenderSectionItemIds;
    return chunk;
  }

  const slug = HUB_SECTION_KEY_TO_SLUG[sectionKey];
  const needsCapsules = sectionKey === "shop_home_capsules";

  if (!slug && !needsCapsules) {
    return chunk;
  }

  const hubPack = await loadHubDataForSectionKeys([sectionKey], ctx);
  if (Object.keys(hubPack.hubSections).length > 0) {
    chunk.initialShopHubSections = hubPack.hubSections;
  }
  if (hubPack.cmsShopFrames.length > 0) {
    chunk.initialCmsShopFrames = hubPack.cmsShopFrames;
  }
  if (needsCapsules) {
    chunk.shopHomeCapsulesSectionDisplay = hubPack.shopHomeCapsulesSectionDisplay;
  }

  const hubItemIds = collectItemIdsFromHubBundles(hubPack.hubSections, hubPack.cmsShopFrames);
  const missingIds = hubItemIds.filter((id) => !existingItemIds.has(id));
  if (missingIds.length > 0) {
    chunk.items = await fetchShopCatalogItemsByIds(ctx.catalogDb, missingIds);
    const coverPatch = await signCoversForNewItems(ctx.catalogDb, chunk.items, existingCovers);
    if (Object.keys(coverPatch).length > 0) {
      chunk.initialCoverUrlById = coverPatch;
    }
  }

  return chunk;
}

export async function loadShopPageRemainder(
  ctx: ShopPageLoadContext,
  loadedSectionKeys: Set<string>,
  existingItemIds: Set<string>,
  existingCovers: Record<string, string>,
): Promise<ShopProgressiveChunk> {
  const catalogSb = ctx.catalogDb as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const remainingHubSlugs = (
    Object.entries(HUB_SECTION_KEY_TO_SLUG) as Array<[string, ShopHubSectionSlug]>
  )
    .filter(([sectionKey]) => !loadedSectionKeys.has(sectionKey))
    .map(([, slug]) => slug);

  const needsCapsules = !loadedSectionKeys.has("shop_home_capsules");
  const [hubSectionsRaw, fullCatalogRes, capsulesPack] = await Promise.all([
    remainingHubSlugs.length > 0
      ? fetchShopHubSectionsBatchCached(remainingHubSlugs)
      : Promise.resolve({} as Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>>),
    catalogSb.rpc("get_shop_catalog_items", { p_limit: 120 }),
    needsCapsules
      ? loadHubDataForSectionKeys(["shop_home_capsules"], ctx)
      : Promise.resolve({
          hubSections: {},
          cmsShopFrames: [] as CmsFrameRow[],
          shopHomeCapsulesSectionDisplay: { hide_section_title: false, title: null },
        }),
  ]);

  const hubSections: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>> = {};
  for (const [slug, bundle] of Object.entries(hubSectionsRaw) as Array<
    [ShopHubSectionSlug, CmsCatalogSectionBundle]
  >) {
    hubSections[slug] = filterHubBundle(bundle, ctx);
  }

  const fullCatalog = parseCatalogItems(fullCatalogRes.data);
  const newCatalogItems = fullCatalog.filter((item) => !existingItemIds.has(item.id));

  const hubItemIds = collectItemIdsFromHubBundles(hubSections, capsulesPack.cmsShopFrames);
  const refExtras = await fetchShopCatalogItemsByIds(
    ctx.catalogDb,
    hubItemIds.filter((id) => !existingItemIds.has(id) && !fullCatalog.some((i) => i.id === id)),
  );

  const mergedNewItems = dedupeCatalogItems([...newCatalogItems, ...refExtras]);
  const coverPatch = await signCoversForNewItems(ctx.catalogDb, mergedNewItems, existingCovers);

  const chunk: ShopProgressiveChunk = {
    sectionKey: "__remainder__",
    items: mergedNewItems,
    initialShopHubSections: hubSections,
  };

  if (capsulesPack.cmsShopFrames.length > 0) {
    chunk.initialCmsShopFrames = capsulesPack.cmsShopFrames;
    chunk.shopHomeCapsulesSectionDisplay = capsulesPack.shopHomeCapsulesSectionDisplay;
  }
  if (Object.keys(coverPatch).length > 0) {
    chunk.initialCoverUrlById = coverPatch;
  }

  if (!loadedSectionKeys.has("shop_system_lenders")) {
    const lenders = await loadFeaturedLendersBlock(ctx);
    chunk.featuredLenders = lenders.featuredLenders;
    chunk.featuredLenderSectionItemIds = lenders.featuredLenderSectionItemIds;
  }

  return chunk;
}

export async function loadShopPagePendingSectionsBatch(
  ctx: ShopPageLoadContext,
  sectionKeys: string[],
  existingItemIds: Set<string>,
  existingCovers: Record<string, string>,
): Promise<ShopProgressiveChunk> {
  if (sectionKeys.length === 0) {
    return { sectionKey: "__batch__", readySectionKeys: [] };
  }

  const hubPack = await loadHubDataForSectionKeys(sectionKeys, ctx);
  const chunk: ShopProgressiveChunk = {
    sectionKey: "__batch__",
    readySectionKeys: sectionKeys,
    initialShopHubSections: hubPack.hubSections,
  };

  if (hubPack.cmsShopFrames.length > 0) {
    chunk.initialCmsShopFrames = hubPack.cmsShopFrames;
  }
  if (sectionKeys.includes("shop_home_capsules")) {
    chunk.shopHomeCapsulesSectionDisplay = hubPack.shopHomeCapsulesSectionDisplay;
  }

  const hubItemIds = collectItemIdsFromHubBundles(hubPack.hubSections, hubPack.cmsShopFrames);
  const missingIds = hubItemIds.filter((id) => !existingItemIds.has(id));
  if (missingIds.length > 0) {
    chunk.items = await fetchShopCatalogItemsByIds(ctx.catalogDb, missingIds);
    const coverPatch = await signCoversForNewItems(ctx.catalogDb, chunk.items, existingCovers);
    if (Object.keys(coverPatch).length > 0) {
      chunk.initialCoverUrlById = coverPatch;
    }
  }

  if (sectionKeys.includes("shop_system_lenders")) {
    const lenders = await loadFeaturedLendersBlock(ctx);
    chunk.featuredLenders = lenders.featuredLenders;
    chunk.featuredLenderSectionItemIds = lenders.featuredLenderSectionItemIds;
  }

  return chunk;
}
