import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import type { LendItem } from "@/components/exchange/ExchangeLendsSection";
import { appendHttpUrls, collectSignedUrlsFromCmsValue } from "@/lib/ui/preload-remote-images";

const DEFAULT_CAP = 64;
export const EXCHANGE_PRELOAD_CAP = 24;

function cappedUrls(urls: Set<string>, cap = DEFAULT_CAP): string[] {
  return [...urls].slice(0, cap);
}

export function collectCmsFrameRowsPreloadUrls(frames: CmsFrameRow[], out = new Set<string>()): Set<string> {
  for (const frame of frames) {
    collectSignedUrlsFromCmsValue(frame.payload, out);
  }
  return out;
}

export function collectCmsSectionsPreloadUrls(
  sections: Record<string, { frames: CmsFrameRow[]; display?: CmsSectionPublishedDisplay }>,
  out = new Set<string>(),
): Set<string> {
  for (const section of Object.values(sections)) {
    collectCmsFrameRowsPreloadUrls(section?.frames ?? [], out);
  }
  return out;
}

export function collectExchangePreloadUrls(input: {
  lends: LendItem[];
  cartLines: CartLineRowData[];
  cmsSectionsByKey: Record<string, { frames: CmsFrameRow[] }>;
  emptyCartCms?: { frames: CmsFrameRow[] };
  emptyLendsCms?: { frames: CmsFrameRow[] };
  ongoingOrders?: Array<{ itemThumbUrls?: string[] }>;
  recentOrders?: Array<{ itemThumbUrls?: string[] }>;
  cap?: number;
}): string[] {
  const urls = new Set<string>();
  appendHttpUrls(
    urls,
    input.lends.map((l) => l.photoUrl),
  );
  appendHttpUrls(
    urls,
    input.cartLines.map((l) => l.photoUrl),
  );
  collectCmsSectionsPreloadUrls(input.cmsSectionsByKey, urls);
  collectCmsFrameRowsPreloadUrls(input.emptyCartCms?.frames ?? [], urls);
  collectCmsFrameRowsPreloadUrls(input.emptyLendsCms?.frames ?? [], urls);
  for (const order of [...(input.ongoingOrders ?? []), ...(input.recentOrders ?? [])]) {
    appendHttpUrls(urls, order.itemThumbUrls ?? []);
  }
  return cappedUrls(urls, input.cap ?? EXCHANGE_PRELOAD_CAP);
}

export function collectCartPreloadUrls(input: {
  cartLines: CartLineRowData[];
  cmsSectionsByKey: Record<string, { frames: CmsFrameRow[] }>;
  initialCoverUrlById?: Record<string, string>;
  cap?: number;
}): string[] {
  const urls = new Set<string>();
  appendHttpUrls(
    urls,
    input.cartLines.map((l) => l.photoUrl),
  );
  collectCmsSectionsPreloadUrls(input.cmsSectionsByKey, urls);
  appendHttpUrls(urls, Object.values(input.initialCoverUrlById ?? {}));
  return cappedUrls(urls, input.cap);
}

export function collectProfilePreloadUrls(input: {
  plusTabCmsFrames?: CmsFrameRow[];
  meTabProfileHeroFrames?: CmsFrameRow[];
  referralBannerFrames?: CmsFrameRow[];
  avatarUrl?: string | null;
  cap?: number;
}): string[] {
  const urls = new Set<string>();
  collectCmsFrameRowsPreloadUrls(input.plusTabCmsFrames ?? [], urls);
  collectCmsFrameRowsPreloadUrls(input.meTabProfileHeroFrames ?? [], urls);
  collectCmsFrameRowsPreloadUrls(input.referralBannerFrames ?? [], urls);
  appendHttpUrls(urls, [input.avatarUrl]);
  return cappedUrls(urls, input.cap);
}
