import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { filterCartOfferFramesForWelcomeGiftEligibility } from "@/lib/cms/welcome-gift-offer-visibility";

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

export function withCollectionSegnaTarget(rows: CmsFrameRow[]): CmsFrameRow[] {
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

export function filterShopCmsBundleForOnboardingOffer(
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

export function filterShopCmsFramesForOnboardingOffer(
  frames: CmsFrameRow[],
  onboardingProcess: string | null | undefined,
  includedCreditsClaimed: boolean,
): CmsFrameRow[] {
  return filterCartOfferFramesForWelcomeGiftEligibility(
    withCollectionSegnaTarget(frames),
    onboardingProcess,
    includedCreditsClaimed,
  );
}
