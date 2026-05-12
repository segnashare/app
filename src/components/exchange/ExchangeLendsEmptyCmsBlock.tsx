"use client";

import { useRouter } from "next/navigation";

import { CartCmsShopHubProvider } from "@/components/cart/CartCmsShopHubProvider";
import { CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS, CmsHorizontalScrollRow } from "@/components/cms/CmsSectionBlocks";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

/**
 * Rail CMS « prêts vides » (`exchange_lends_empty`) — même intégration que le panier vide dans `ExchangeCartSection`.
 */
export function ExchangeLendsEmptyCmsBlock({
  cms,
  catalogItems,
  guideExchangeOnboarding = false,
}: {
  cms: { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay };
  catalogItems: ShopCatalogItem[];
  guideExchangeOnboarding?: boolean;
}) {
  const router = useRouter();
  if (cms.frames.length === 0) return null;

  return (
    <CartCmsShopHubProvider catalogItems={catalogItems} onCartMutation={() => router.refresh()}>
      {!cms.display.hide_section_title ? (
        <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
          {cms.display.title?.trim() || "Pour commencer"}
        </h2>
      ) : null}
      <CmsHorizontalScrollRow
        rows={cms.frames}
        className={cn(
          cms.display.hide_section_title && "!mt-0",
          guideExchangeOnboarding && "segna-guidance-shimmer-active",
        )}
        hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
        layout="rail"
      />
    </CartCmsShopHubProvider>
  );
}
