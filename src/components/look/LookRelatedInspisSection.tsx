"use client";

import { useMemo } from "react";

import { InspirationMasonryGrid } from "@/components/community/InspirationMasonryGrid";
import type { ItemStyleLookSummary } from "@/lib/items/fetch-item-style-looks";
import { styleLookSummaryToFeedCard } from "@/lib/looks/style-look-to-feed-card";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type LookRelatedInspisSectionProps = {
  looks: ItemStyleLookSummary[];
};

function hasRenderableMedia(look: ItemStyleLookSummary): boolean {
  if (look.media_urls.length > 0) return true;
  return Boolean(look.poster_url);
}

export function LookRelatedInspisSection({ looks }: LookRelatedInspisSectionProps) {
  const feedCards = useMemo(
    () => looks.filter(hasRenderableMedia).map(styleLookSummaryToFeedCard),
    [looks],
  );

  if (feedCards.length === 0) return null;

  return (
    <section aria-label="Plus d'inspirations" className="pb-6 pt-6">
      <div className="px-6 pb-3">
        <h3 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
          Plus d&apos;inspirations
        </h3>
      </div>

      <div className="px-3">
        <InspirationMasonryGrid cards={feedCards} compact />
      </div>
    </section>
  );
}
