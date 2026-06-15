"use client";

import { useMemo } from "react";

import { ShopCatalog } from "@/components/shop/ShopCatalog";
import { AppPageLoading } from "@/components/ui/AppPageLoading";
import { PageImageReadyShell } from "@/components/ui/PageImageReadyShell";
import type { ShopPageCatalogPayload } from "@/lib/shop/shop-page-progressive-shared";
import { collectShopCatalogPreloadImageUrls } from "@/lib/shop/shop-catalog-preload-images";

/** @deprecated Préférer `AppPageLoading`. */
export const ShopCatalogPageLoading = AppPageLoading;

type ShopCatalogReadyShellProps = {
  payload: ShopPageCatalogPayload;
};

export function ShopCatalogReadyShell({ payload }: ShopCatalogReadyShellProps) {
  const preloadUrls = useMemo(
    () =>
      collectShopCatalogPreloadImageUrls({
        initialCoverUrlById: payload.initialCoverUrlById,
        initialCmsShopFrames: payload.initialCmsShopFrames,
        initialShopHubSections: payload.initialShopHubSections,
        featuredLenders: payload.featuredLenders,
      }),
    [
      payload.initialCoverUrlById,
      payload.initialCmsShopFrames,
      payload.initialShopHubSections,
      payload.featuredLenders,
    ],
  );

  return (
    <PageImageReadyShell preloadUrls={preloadUrls} loadingLabel="Chargement de la boutique">
      <ShopCatalog
        initialItems={payload.initialItems}
        initialLikedItemIds={payload.initialLikedItemIds}
        initialMostLikedItems={payload.initialMostLikedItems}
        initialCoverUrlById={payload.initialCoverUrlById}
        categories={payload.categories}
        sizes={payload.sizes}
        brands={payload.brands}
        colors={payload.colors}
        materials={payload.materials}
        featuredLenders={payload.featuredLenders}
        featuredLenderSectionItemIds={payload.featuredLenderSectionItemIds}
        initialCmsShopFrames={payload.initialCmsShopFrames}
        shopHomeCapsulesSectionDisplay={payload.shopHomeCapsulesSectionDisplay}
        initialShopHubSections={payload.initialShopHubSections}
        boutiqueHubSectionOrder={payload.boutiqueHubSectionOrder}
        guideCartOnboarding={payload.guideCartOnboarding}
        readyHubSectionKeys={payload.boutiqueHubSectionOrder}
      />
    </PageImageReadyShell>
  );
}
