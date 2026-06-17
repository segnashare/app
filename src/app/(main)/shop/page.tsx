import { Suspense } from "react";

import { MainContent } from "@/components/layout/MainContent";
import { ShopViewTracker } from "@/components/analytics/ShopViewTracker";
import { AppPageLoading } from "@/components/ui/AppPageLoading";
import { ShopCatalogReadyShell } from "@/components/shop/ShopCatalogReadyShell";
import { buildShopPageLoadContext } from "@/lib/shop/build-shop-page-load-context";
import { loadShopPageFull } from "@/lib/shop/load-shop-page-progressive";
import { createPerfTracker } from "@/lib/perf/server-timing";

export default function ShopPage() {
  return (
    <Suspense
      fallback={
        <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
          <AppPageLoading label="Chargement de la boutique" />
        </MainContent>
      }
    >
      <ShopPageAsync />
    </Suspense>
  );
}

async function ShopPageAsync() {
  const perf = createPerfTracker("page:/shop");
  const ctx = await perf.measure("shop.loadContext", buildShopPageLoadContext);
  if (!ctx) {
    return null;
  }

  const payload = await perf.measure("shop.full", () => loadShopPageFull(ctx));
  perf.log({
    initialItems: payload.initialItems.length,
    readySections: payload.readyHubSectionKeys.length,
    signedCovers: Object.keys(payload.initialCoverUrlById).length,
  });

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopViewTracker />
      <ShopCatalogReadyShell payload={payload} />
    </MainContent>
  );
}
