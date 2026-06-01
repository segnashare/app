"use client";

import { CartCmsShopHubProvider } from "@/components/cart/CartCmsShopHubProvider";
import { CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS, CmsHorizontalScrollRow } from "@/components/cms/CmsSectionBlocks";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { isWelcomeGiftOfferCmsFrame } from "@/lib/cms/welcome-gift-offer-visibility";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

export type ExchangeDynamicCmsSectionProps = {
  sectionKey: string;
  cms: { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay };
  guideOfferOnboarding?: boolean;
};

export function ExchangeDynamicCmsSection({ sectionKey, cms, guideOfferOnboarding = false }: ExchangeDynamicCmsSectionProps) {
  const visibleFrames = guideOfferOnboarding
    ? cms.frames
    : cms.frames.filter((row) => !isWelcomeGiftOfferCmsFrame(row));
  if (visibleFrames.length === 0) return null;

  return (
    <CartCmsShopHubProvider catalogItems={[]}>
      <section className="bg-white px-5 py-4">
        {!cms.display.hide_section_title ? (
          <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {cms.display.title?.trim() || sectionKey}
          </h2>
        ) : null}
        <CmsHorizontalScrollRow
          rows={visibleFrames}
          className={cn(cms.display.hide_section_title && "!mt-0")}
          hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
        />
      </section>
    </CartCmsShopHubProvider>
  );
}
