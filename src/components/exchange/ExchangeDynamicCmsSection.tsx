"use client";

import { CartCmsShopHubProvider } from "@/components/cart/CartCmsShopHubProvider";
import { CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS, CmsHorizontalScrollRow } from "@/components/cms/CmsSectionBlocks";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

export type ExchangeDynamicCmsSectionProps = {
  sectionKey: string;
  cms: { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay };
};

/**
 * Sections CMS additionnelles sur la page Échange (hors blocs natifs et `commerce_promo_ad`).
 * Gabarit large systématique (`w-full` dans la colonne, comme Prêts et `commerce_promo_ad`) pour éviter
 * le rail défaut 88vw/90 % plus étroit — ex. section BO « Nos offres » (`nos_offres`, etc.).
 */
export function ExchangeDynamicCmsSection({ sectionKey, cms }: ExchangeDynamicCmsSectionProps) {
  if (cms.frames.length === 0) return null;

  return (
    <CartCmsShopHubProvider catalogItems={[]}>
      <section className="bg-white px-5 py-4">
        {!cms.display.hide_section_title ? (
          <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {cms.display.title?.trim() || sectionKey}
          </h2>
        ) : null}
        <CmsHorizontalScrollRow
          rows={cms.frames}
          className={cms.display.hide_section_title ? "!mt-0" : undefined}
          hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
        />
      </section>
    </CartCmsShopHubProvider>
  );
}
