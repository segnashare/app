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
  guideOfferOnboarding?: boolean;
};

/**
 * Sections CMS additionnelles sur la page Échange (hors blocs natifs et `commerce_promo_ad`).
 * Gabarit large systématique (`w-full` dans la colonne, comme Prêts et `commerce_promo_ad`) pour éviter
 * le rail défaut 88vw/90 % plus étroit — ex. section BO « Nos offres » (`nos_offres`, etc.).
 */
function isOfferGuidanceSection(sectionKey: string, cms: ExchangeDynamicCmsSectionProps["cms"]): boolean {
  const normalizedKey = sectionKey.toLowerCase();
  if (normalizedKey.includes("offer") || normalizedKey.includes("offre")) return true;
  return cms.frames.some((frame) => {
    const payload = frame.payload ?? {};
    const haystack = [
      payload.target_url,
      payload.title,
      payload.label,
      payload.subtitle,
      payload.cta_label,
      payload.button_label,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    return haystack.includes("/package") || haystack.includes("segnax") || haystack.includes("crédit");
  });
}

export function ExchangeDynamicCmsSection({ sectionKey, cms, guideOfferOnboarding = false }: ExchangeDynamicCmsSectionProps) {
  if (cms.frames.length === 0) return null;
  const shouldGuideOfferFrames = guideOfferOnboarding && isOfferGuidanceSection(sectionKey, cms);

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
          className={cn(cms.display.hide_section_title && "!mt-0", shouldGuideOfferFrames && "segna-guidance-shimmer-active")}
          hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
        />
      </section>
    </CartCmsShopHubProvider>
  );
}
