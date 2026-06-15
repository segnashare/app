import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { ShopHubSectionSlug } from "@/lib/cms/shop-hub-sections";
import type { ShopFeaturedLender } from "@/components/shop/ShopCatalog";
import { appendHttpUrls, collectSignedUrlsFromCmsValue } from "@/lib/ui/preload-remote-images";

const DEFAULT_PRELOAD_CAP = 64;

export function collectShopCatalogPreloadImageUrls(input: {
  initialCoverUrlById?: Record<string, string>;
  initialCmsShopFrames?: CmsFrameRow[];
  initialShopHubSections?: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>>;
  featuredLenders?: ShopFeaturedLender[];
  cap?: number;
}): string[] {
  const urls = new Set<string>();
  appendHttpUrls(urls, Object.values(input.initialCoverUrlById ?? {}));

  for (const frame of input.initialCmsShopFrames ?? []) {
    collectSignedUrlsFromCmsValue(frame.payload, urls);
  }

  for (const bundle of Object.values(input.initialShopHubSections ?? {})) {
    for (const frame of bundle?.frames ?? []) {
      collectSignedUrlsFromCmsValue(frame.payload, urls);
    }
  }

  for (const lender of input.featuredLenders ?? []) {
    appendHttpUrls(urls, [lender.avatarUrl]);
  }

  const cap = input.cap ?? DEFAULT_PRELOAD_CAP;
  return [...urls].slice(0, cap);
}

export { preloadRemoteImages as preloadShopCatalogImages } from "@/lib/ui/preload-remote-images";
