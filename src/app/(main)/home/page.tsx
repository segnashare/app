import { Suspense } from "react";

import { MainContent } from "@/components/layout/MainContent";
import { HomePageReadyShell } from "@/components/home/HomePageReadyShell";
import { HomePageView } from "@/components/home/HomePageView";
import { AppPageLoading } from "@/components/ui/AppPageLoading";
import { fetchCommunityFeed } from "@/lib/community/fetch-community-feed";
import { resolveInspirationCardsMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import { getCurrentAuthUser } from "@/lib/auth/current-user-server";
import { collectCmsShopItemIdsFromSectionsByKey } from "@/lib/cms/collect-cms-shop-item-ids";
import { fetchCmsCatalogSectionResolved, type CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import { fetchHomeSectionOrder } from "@/lib/cms/fetch-home-section-order";
import { HOME_HERO_SECTION_KEY } from "@/lib/cms/home-hero-section";
import { HOME_NATIVE_SECTION_KEYS } from "@/lib/cms/home-section-order";
import { loadHomeCmsSections } from "@/lib/cms/load-home-cms-sections";
import { loadShopSectionItems } from "@/lib/shop/load-shop-section-items";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
          <AppPageLoading label="Chargement de l'accueil" />
        </MainContent>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}

async function HomePageContent() {
  const supabase = await createSupabaseServerClient();
  const { user } = await getCurrentAuthUser();
  if (!user) return null;

  const sectionOrder = await fetchHomeSectionOrder(supabase);
  const heroBundle = await fetchCmsCatalogSectionResolved(supabase, HOME_HERO_SECTION_KEY);
  const heroFrames = heroBundle.frames;
  const showHero = heroFrames.length > 0;

  return (
    <MainContent
      className={`!space-y-0 !px-0 !pb-28 ${showHero ? "!pt-0" : "!pt-4"}`}
    >
      <HomePageReadyShell heroFrames={heroFrames}>
        <Suspense fallback={null}>
          <HomePageBelowFold sectionOrder={sectionOrder} heroFrames={heroFrames} userId={user.id} />
        </Suspense>
      </HomePageReadyShell>
    </MainContent>
  );
}

async function HomePageBelowFold({
  sectionOrder,
  heroFrames,
  userId,
}: {
  sectionOrder: string[];
  heroFrames: Awaited<ReturnType<typeof fetchCmsCatalogSectionResolved>>["frames"];
  userId: string;
}) {
  const supabase = await createSupabaseServerClient();
  const otherSectionKeys = sectionOrder.filter((key) => key !== HOME_HERO_SECTION_KEY);

  const [nouveautesItems, feedPayload, otherSectionBundles] = await Promise.all([
    loadShopSectionItems(supabase, "discover", { userId, featuredLenderItemIds: [] }),
    fetchCommunityFeed(supabase, { mode: "explorer", limit: 16 }),
    loadHomeCmsSections(supabase, otherSectionKeys),
  ]);

  const allSectionBundles: Record<string, CmsCatalogSectionBundle> = {
    ...otherSectionBundles,
    [HOME_HERO_SECTION_KEY]: { config: {}, frames: heroFrames },
  };

  const cmsSectionsByKey = Object.fromEntries(
    Object.entries(allSectionBundles).filter(
      ([key]) => !HOME_NATIVE_SECTION_KEYS.has(key) && key !== HOME_HERO_SECTION_KEY,
    ),
  );

  const nativeSectionConfigByKey = Object.fromEntries(
    sectionOrder
      .filter((key) => HOME_NATIVE_SECTION_KEYS.has(key))
      .map((key) => [key, allSectionBundles[key]?.config ?? {}]),
  );

  const cmsShopItemIds = collectCmsShopItemIdsFromSectionsByKey(
    Object.fromEntries(
      Object.entries(cmsSectionsByKey).map(([key, bundle]) => [key, { frames: bundle.frames }]),
    ),
  );
  const cmsCatalogItems =
    cmsShopItemIds.length > 0 ? await fetchShopCatalogItemsByIds(supabase, cmsShopItemIds) : [];

  const feedCards = await resolveInspirationCardsMediaUrls(supabase, feedPayload.cards);
  const coverUrlById = await resolveShopCatalogCoverUrlsServer(supabase, [
    ...nouveautesItems.slice(0, 12),
    ...cmsCatalogItems,
  ]);

  return (
    <HomePageView
      sectionOrder={sectionOrder}
      heroFrames={heroFrames}
      nouveautesItems={nouveautesItems}
      initialCoverUrlById={coverUrlById}
      feedCards={feedCards}
      cmsSectionsByKey={cmsSectionsByKey}
      cmsCatalogItems={cmsCatalogItems}
      nativeSectionConfigByKey={nativeSectionConfigByKey}
    />
  );
}
