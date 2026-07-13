"use client";

import { HomeHeroSection } from "@/components/home/HomeHeroSection";
import { HomePageHeader } from "@/components/home/HomePageHeader";
import { HomePageSections } from "@/components/home/HomePageSections";
import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { InspirationFeedCard } from "@/lib/community/types";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";

type HomePageViewProps = {
  sectionOrder: string[];
  heroFrames: CmsFrameRow[];
  nouveautesItems: ShopCatalogItem[];
  initialCoverUrlById: Record<string, string>;
  feedCards: InspirationFeedCard[];
  cmsSectionsByKey: Record<string, CmsCatalogSectionBundle>;
  cmsCatalogItems: ShopCatalogItem[];
  nativeSectionConfigByKey: Record<string, CmsCatalogSectionBundle["config"]>;
};

export function HomePageView({
  sectionOrder,
  heroFrames,
  nouveautesItems,
  initialCoverUrlById,
  feedCards,
  cmsSectionsByKey,
  cmsCatalogItems,
  nativeSectionConfigByKey,
}: HomePageViewProps) {
  const showHero = heroFrames.length > 0;

  return (
    <div className={showHero ? "space-y-6 pb-4" : "space-y-8 pb-4"}>
      {showHero ? <HomeHeroSection frames={heroFrames} /> : <HomePageHeader />}
      <HomePageSections
        sectionOrder={sectionOrder}
        nouveautesItems={nouveautesItems}
        initialCoverUrlById={initialCoverUrlById}
        feedCards={feedCards}
        cmsSectionsByKey={cmsSectionsByKey}
        cmsCatalogItems={cmsCatalogItems}
        nativeSectionConfigByKey={nativeSectionConfigByKey}
      />
    </div>
  );
}
