import { Suspense } from "react";

import { MainContent } from "@/components/layout/MainContent";
import { ShopCatalogProgressiveShell } from "@/components/shop/ShopCatalogProgressiveShell";
import { ShopCatalogLoadingFallback } from "@/components/shop/ShopCatalogLoadingFallback";
import { buildShopPageLoadContext } from "@/lib/shop/build-shop-page-load-context";
import { loadShopPageCritical } from "@/lib/shop/load-shop-page-progressive";
import { createPerfTracker } from "@/lib/perf/server-timing";

export default function ShopPage() {
  return (
    <Suspense fallback={<ShopCatalogLoadingFallback />}>
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

  const critical = await perf.measure("shop.critical", () => loadShopPageCritical(ctx));
  perf.log({
    initialItems: critical.initialItems.length,
    readySections: critical.readyHubSectionKeys.length,
    signedCovers: Object.keys(critical.initialCoverUrlById).length,
  });

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopCatalogProgressiveShell critical={critical} />
    </MainContent>
  );
}
