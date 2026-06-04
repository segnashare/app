import dynamic from "next/dynamic";
import { Suspense } from "react";

import { MainContent } from "@/components/layout/MainContent";
import { ShopCatalogLoadingFallback } from "@/components/shop/ShopCatalogLoadingFallback";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { filterCartOfferFramesForWelcomeGiftEligibility } from "@/lib/cms/welcome-gift-offer-visibility";
import { hasOnboardingIncludedCreditsGrant, resolveOnboardingProcessForOfferVisibility } from "@/lib/onboarding/activate-included-credits";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import { isShopFeaturedRealMember } from "@/lib/shop/merge-featured-lenders";
import {
  fetchShopFeaturedLendersWithProfilePhotos,
  type FetchShopFeaturedLendersOptions,
} from "@/lib/shop/resolve-shop-featured-lenders-server";
import { buildShopDepartmentHubRail } from "@/lib/shop/shop-department-categories";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";
import { createPerfTracker } from "@/lib/perf/server-timing";
import { createSupabaseDemoAdminClient } from "@/lib/supabase/demo-admin";
import {
  fetchBoutiqueHubSectionOrderCached,
  fetchShopHomeCapsulesDisplayCached,
  fetchShopHomeCapsulesFramesCached,
  fetchShopHubCategoriesCached,
  fetchShopHubDealsCached,
  fetchShopHubDiscoverCached,
  fetchShopHubFrenchCached,
  fetchShopHubPreferredBrandsCached,
  loadShopBoutiqueFilterFacetResponses,
} from "@/lib/shop/shop-boutique-data-cache";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import { mapCategoryFilterRows, mapFilterRows, mapSizeFilterRows } from "@/lib/shop/shop-filter-options";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

const ShopCatalogDynamic = dynamic(
  () => import("@/components/shop/ShopCatalog").then((m) => m.ShopCatalog),
  { loading: () => <ShopCatalogLoadingFallback /> },
);

const SEGNA_COLLECTION_SHOP_HREF = "/shop/collection-segna";

function isCollectionSegnaFrame(row: CmsFrameRow): boolean {
  const payload = row.payload ?? {};
  if (payload.target_url?.trim() === "/segna-collection") return true;
  return [payload.title, payload.header, payload.label, payload.subtitle].some(
    (value) =>
      typeof value === "string" &&
      ["collection segna", "propriété segna", "propriete segna"].includes(value.trim().toLowerCase()),
  );
}

function withCollectionSegnaTarget(rows: CmsFrameRow[]): CmsFrameRow[] {
  return rows.map((row) =>
    isCollectionSegnaFrame(row)
      ? {
          ...row,
          payload: {
            ...row.payload,
            target_url: SEGNA_COLLECTION_SHOP_HREF,
          },
        }
      : row,
  );
}

function withCollectionSegnaTargetBundle(bundle: CmsCatalogSectionBundle): CmsCatalogSectionBundle {
  return {
    ...bundle,
    frames: withCollectionSegnaTarget(bundle.frames),
  };
}

function filterShopCmsBundleForOnboardingOffer(
  bundle: CmsCatalogSectionBundle,
  onboardingProcess: string | null | undefined,
  includedCreditsClaimed: boolean,
): CmsCatalogSectionBundle {
  return {
    ...bundle,
    frames: filterCartOfferFramesForWelcomeGiftEligibility(
      withCollectionSegnaTarget(bundle.frames),
      onboardingProcess,
      includedCreditsClaimed,
    ),
  };
}

export default function ShopPage() {
  return (
    <Suspense fallback={<ShopCatalogLoadingFallback />}>
      <ShopPageAsync />
    </Suspense>
  );
}

async function ShopPageAsync() {
  const perf = createPerfTracker("page:/shop");
  const supabase = await createSupabaseServerClient();
  const { user } = await perf.measure("auth.getUser", getCurrentAuthUser);
  if (!user) {
    return null;
  }

  const admin = createSupabaseAdminClient() as any;
  const [userState, includedCreditsClaimed] = await Promise.all([
    perf.measure("users.appState", () => getCurrentUserAppState(user.id)),
    perf.measure("wallet.onboardingGrant", () => hasOnboardingIncludedCreditsGrant(admin, user.id)),
  ]);
  const onboardingProcess = await resolveOnboardingProcessForOfferVisibility(
    admin,
    user.id,
    userState.onboarding_process ?? null,
    includedCreditsClaimed,
  );
  const isDemoMode = userState.onboarding_mode === "demo";
  const guideCartOnboarding = userState.onboarding_process === "panier";
  const demoAdmin = isDemoMode ? createSupabaseDemoAdminClient() : null;
  const catalogDb = demoAdmin ?? supabase;
  const catalogSb = catalogDb as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    from: (t: string) => {
      select: (c: string) => {
        order: (c: string, o?: { ascending?: boolean }) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };

  const [
    catalogResFinal,
    mostLikedResFinal,
    facetPack,
    favRes,
    cmsShopFrames,
    shopHomeCapsulesDisplay,
    cmsHubDiscover,
    cmsHubCategories,
    cmsHubPreferredBrands,
    cmsHubDeals,
    cmsHubFrench,
    boutiqueHubSectionOrder,
  ] = await Promise.all([
    perf.measure("rpc.get_shop_catalog_items", () => catalogSb.rpc("get_shop_catalog_items", { p_limit: 120 })),
    perf.measure("rpc.get_shop_most_liked_items", () => catalogSb.rpc("get_shop_most_liked_items", { p_limit: 10 })),
    perf.measure("filters.facets", () => loadShopBoutiqueFilterFacetResponses(isDemoMode, supabase)),
    perf.measure("favorites.initial", () =>
      supabase
        .from("item_favorites")
        .select("item_id")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
    ),
    perf.measure("cms.shop_home_capsules.frames", () => fetchShopHomeCapsulesFramesCached()),
    perf.measure("cms.shop_home_capsules.display", () => fetchShopHomeCapsulesDisplayCached()),
    perf.measure("cms.hub.discover", () => fetchShopHubDiscoverCached()),
    perf.measure("cms.hub.categories", () => fetchShopHubCategoriesCached()),
    perf.measure("cms.hub.preferredBrands", () => fetchShopHubPreferredBrandsCached()),
    perf.measure("cms.hub.deals", () => fetchShopHubDealsCached()),
    perf.measure("cms.hub.french", () => fetchShopHubFrenchCached()),
    perf.measure("cms.hub.order", () => fetchBoutiqueHubSectionOrderCached()),
  ]);

  const { catResFinal, sizeResFinal, brandResFinal, colResFinal, matResFinal } = facetPack;

  if (process.env.SEGNA_DEBUG_CMS === "1") {
    const categoriesTree = mapCategoryFilterRows(catResFinal.data);
    const railDbg = buildShopDepartmentHubRail(categoriesTree, cmsHubCategories.frames);
    console.info(
      "[SEGNA_DEBUG_CMS] rail Catégories (buildShopDepartmentHubRail):",
      railDbg.length,
      railDbg.map((d) => ({
        slug: d.slug,
        label: d.label,
        frameId: d.linkFrame?.id,
        target_url:
          d.linkFrame && typeof d.linkFrame.payload.target_url === "string"
            ? d.linkFrame.payload.target_url
            : "",
      })),
    );
  }

  const catalogPayload = (catalogResFinal.data ?? { items: [] }) as { items?: ShopCatalogItem[] };
  const initialItems = Array.isArray(catalogPayload.items) ? catalogPayload.items : [];
  const cmsShopFramesWithTargets = filterCartOfferFramesForWelcomeGiftEligibility(
    withCollectionSegnaTarget(cmsShopFrames),
    onboardingProcess,
    includedCreditsClaimed,
  );

  const hubBundles: Record<string, CmsCatalogSectionBundle | undefined> = {
    discover: filterShopCmsBundleForOnboardingOffer(cmsHubDiscover, onboardingProcess, includedCreditsClaimed),
    categories: filterShopCmsBundleForOnboardingOffer(cmsHubCategories, onboardingProcess, includedCreditsClaimed),
    preferredBrands: filterShopCmsBundleForOnboardingOffer(
      cmsHubPreferredBrands,
      onboardingProcess,
      includedCreditsClaimed,
    ),
    deals: filterShopCmsBundleForOnboardingOffer(cmsHubDeals, onboardingProcess, includedCreditsClaimed),
    french: filterShopCmsBundleForOnboardingOffer(cmsHubFrench, onboardingProcess, includedCreditsClaimed),
  };

  const hubReferencedItemIds = new Set<string>();
  for (const b of Object.values(hubBundles)) {
    for (const f of b?.frames ?? []) {
      if (f.frame_type !== "shop_item_ref") continue;
      const id = typeof f.payload.item_id === "string" ? f.payload.item_id.trim() : "";
      if (id) hubReferencedItemIds.add(id);
    }
  }

  const inInitialCatalog = new Set(initialItems.map((i) => i.id));
  const idsToFetchForHub = [...hubReferencedItemIds].filter((id) => !inInitialCatalog.has(id));
  const hubExtraItems = await perf.measure("hub.extraItems", () => fetchShopCatalogItemsByIds(catalogDb, idsToFetchForHub));
  const initialItemsForShop = [...initialItems];
  for (const it of hubExtraItems) {
    if (!inInitialCatalog.has(it.id)) {
      initialItemsForShop.push(it);
      inInitialCatalog.add(it.id);
    }
  }

  const mostLikedPayload = (mostLikedResFinal.error ? { items: [] } : (mostLikedResFinal.data ?? { items: [] })) as {
    items?: ShopCatalogItem[];
  };
  const initialMostLikedItems = Array.isArray(mostLikedPayload.items) ? mostLikedPayload.items : [];

  const itemsForCoverSigning: ShopCatalogItem[] = [];
  const seenCoverIds = new Set<string>();
  for (const it of [...initialItemsForShop, ...initialMostLikedItems]) {
    if (seenCoverIds.has(it.id)) continue;
    seenCoverIds.add(it.id);
    itemsForCoverSigning.push(it);
  }
  const initialCoverUrlById = await perf.measure("shop.coverUrls", () =>
    resolveShopCatalogCoverUrlsServer(catalogDb as unknown as StorageSignClient, itemsForCoverSigning),
  );

  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  /** Grille : membres réels avec photo de profil (jusqu’à 9). */
  const featuredLenderDb = catalogSb as unknown as FetchShopFeaturedLendersOptions["catalogDb"];
  let realFeaturedLenders: Awaited<ReturnType<typeof fetchShopFeaturedLendersWithProfilePhotos>> = [];
  try {
    realFeaturedLenders = await perf.measure("shop.featuredLenders", () =>
      fetchShopFeaturedLendersWithProfilePhotos({
        catalogDb: featuredLenderDb,
        maxMembers: 9,
        excludeUserId: user.id,
      }),
    );
  } catch (err) {
    console.error("[shop] featuredLenders failed:", err);
  }
  const featuredLenders = realFeaturedLenders.slice(0, 9);
  if (process.env.SEGNA_DEBUG_CMS === "1") {
    console.info("[shop] featuredLenders", {
      real: realFeaturedLenders.length,
      total: featuredLenders.length,
      ids: featuredLenders.map((l) => l.userId),
    });
  }

  const featuredLenderUserIds = featuredLenders.filter(isShopFeaturedRealMember).map((l) => l.userId);
  let featuredLenderSectionItemIds: string[] = [];
  if (featuredLenderUserIds.length > 0) {
    const { data: itemRows } = await supabase
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
  perf.log({
    initialItems: initialItemsForShop.length,
    cmsHubRefs: hubReferencedItemIds.size,
  });

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopCatalogDynamic
        initialItems={initialItemsForShop}
        initialLikedItemIds={initialLikedItemIds}
        initialMostLikedItems={initialMostLikedItems}
        initialCoverUrlById={initialCoverUrlById}
        categories={mapCategoryFilterRows(catResFinal.data)}
        sizes={mapSizeFilterRows(sizeResFinal.data)}
        brands={mapFilterRows(brandResFinal.data)}
        colors={mapFilterRows(colResFinal.data)}
        materials={mapFilterRows(matResFinal.data)}
        featuredLenders={featuredLenders}
        featuredLenderSectionItemIds={featuredLenderSectionItemIds}
        initialCmsShopFrames={cmsShopFramesWithTargets}
        shopHomeCapsulesSectionDisplay={shopHomeCapsulesDisplay}
        initialShopHubSections={{
          discover: hubBundles.discover,
          categories: hubBundles.categories,
          preferredBrands: hubBundles.preferredBrands,
          deals: hubBundles.deals,
          french: hubBundles.french,
        }}
        boutiqueHubSectionOrder={boutiqueHubSectionOrder}
        guideCartOnboarding={guideCartOnboarding}
      />
    </MainContent>
  );
}
