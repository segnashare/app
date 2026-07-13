"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CartCmsShopHubProvider } from "@/components/cart/CartCmsShopHubProvider";
import {
  CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS,
  CmsFrameItem,
  CmsFrameLayoutModeProvider,
  CmsHorizontalScrollRow,
  CmsShopHubLinkCardRail,
} from "@/components/cms/CmsSectionBlocks";
import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";

const LINK_CARD_FRAME_TYPES = new Set([
  "shop_link_card",
  "shop_category_ref",
  "shop_brand_ref",
  "editorial_card",
  "promo_ad",
  "offer_card",
  "category_capsule",
]);

function HomeSectionHeader({ title, sectionHref }: { title: string; sectionHref?: string }) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-3 px-3">
      <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>{title}</h2>
      {sectionHref ? (
        <Link
          href={sectionHref}
          aria-label={`Voir la sélection : ${title}`}
          className="mt-1 inline-flex shrink-0 items-center justify-center text-zinc-800 transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35"
        >
          <ArrowRight className="h-5 w-5" strokeWidth={2.2} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

type HomeCmsSectionBlockProps = {
  sectionKey: string;
  bundle: CmsCatalogSectionBundle;
  catalogItems: ShopCatalogItem[];
  initialCoverUrlById: Record<string, string>;
};

export function HomeCmsSectionBlock({
  sectionKey,
  bundle,
  catalogItems,
  initialCoverUrlById,
}: HomeCmsSectionBlockProps) {
  const { config, frames } = bundle;
  if (frames.length === 0) return null;

  const title = config.title?.trim() || sectionKey;
  const sectionHref =
    config.show_more_arrow && config.more_href?.trim() ? config.more_href.trim() : undefined;
  const allLinkCards = frames.every((row) => LINK_CARD_FRAME_TYPES.has(row.frame_type));
  const multiFrames = frames.length > 1;

  return (
    <CartCmsShopHubProvider catalogItems={catalogItems} initialCoverUrlById={initialCoverUrlById}>
      <section className="space-y-3">
        {!config.hide_section_title ? <HomeSectionHeader title={title} sectionHref={sectionHref} /> : null}
        {allLinkCards ? (
          <CmsFrameLayoutModeProvider mode={multiFrames ? "hub" : "stack"}>
            <div className={cn(!multiFrames && "px-5")}>
              <CmsShopHubLinkCardRail>
                {frames.map((row) => (
                  <CmsFrameItem key={row.id} row={row} layoutMode={multiFrames ? "hub" : "stack"} />
                ))}
              </CmsShopHubLinkCardRail>
            </div>
          </CmsFrameLayoutModeProvider>
        ) : (
          <div className="px-5">
            <CmsHorizontalScrollRow
              rows={frames}
              className={cn(config.hide_section_title && "!mt-0")}
              hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
              layout={multiFrames ? "rail" : "stack"}
            />
          </div>
        )}
      </section>
    </CartCmsShopHubProvider>
  );
}
