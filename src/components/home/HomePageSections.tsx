"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { InspirationMasonryGrid } from "@/components/community/InspirationMasonryGrid";
import { HomeCmsSectionBlock } from "@/components/home/HomeCmsSectionBlock";
import {
  emptyShopCatalogFilters,
  ItemRailTwoUp,
  type ShopCatalogItem,
} from "@/components/shop/ShopCatalog";
import { useToggleCartItem } from "@/hooks/useToggleCartItem";
import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import { HOME_NATIVE_SECTION_KEYS } from "@/lib/cms/home-section-order";
import { HOME_HERO_SECTION_KEY } from "@/lib/cms/home-hero-section";
import { createInspirationHref } from "@/lib/community/create-inspiration-href";
import type { InspirationFeedCard } from "@/lib/community/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type HomePageSectionsProps = {
  sectionOrder: string[];
  nouveautesItems: ShopCatalogItem[];
  initialCoverUrlById: Record<string, string>;
  feedCards: InspirationFeedCard[];
  cmsSectionsByKey: Record<string, CmsCatalogSectionBundle>;
  cmsCatalogItems: ShopCatalogItem[];
  nativeSectionConfigByKey: Record<string, CmsCatalogSectionBundle["config"]>;
};

const SHIMMER_SEC = 2.85;

export function HomePageSections({
  sectionOrder,
  nouveautesItems,
  initialCoverUrlById,
  feedCards,
  cmsSectionsByKey,
  cmsCatalogItems,
  nativeSectionConfigByKey,
}: HomePageSectionsProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { cartItemIds, cartBusyIds, toggleCart } = useToggleCartItem();
  const [coverUrlById] = useState<Record<string, string>>(initialCoverUrlById);
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const [likeBusyIds, setLikeBusyIds] = useState<Set<string>>(new Set());

  const visibleNouveautes = useMemo(
    () => nouveautesItems.filter((item) => item.status === "available" || item.status === "in_cart").slice(0, 12),
    [nouveautesItems],
  );

  const likeItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of visibleNouveautes) ids.add(item.id);
    for (const item of cmsCatalogItems) ids.add(item.id);
    return [...ids];
  }, [visibleNouveautes, cmsCatalogItems]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled || likeItemIds.length === 0) return;
      const { data } = await supabase
        .from("item_favorites")
        .select("item_id")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .in("item_id", likeItemIds);
      if (!cancelled && data) {
        setLikedSet(new Set(data.map((row: { item_id: string }) => row.item_id)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, likeItemIds]);

  const withLikeBusy = useCallback(async (itemId: string, action: () => Promise<void>) => {
    if (likeBusyIds.has(itemId)) return;
    setLikeBusyIds((current) => new Set([...current, itemId]));
    try {
      await action();
    } finally {
      setLikeBusyIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  }, [likeBusyIds]);

  const handleToggleLike = useCallback(
    async (targetItemId: string) => {
      await withLikeBusy(targetItemId, async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const likedNow = likedSet.has(targetItemId);
        setLikedSet((current) => {
          const next = new Set(current);
          if (likedNow) next.delete(targetItemId);
          else next.add(targetItemId);
          return next;
        });

        if (likedNow) {
          await supabase
            .from("item_favorites")
            .update({ deleted_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .eq("item_id", targetItemId)
            .is("deleted_at", null);
          return;
        }

        const { data: existingAny } = await supabase
          .from("item_favorites")
          .select("id")
          .eq("user_id", user.id)
          .eq("item_id", targetItemId)
          .maybeSingle();

        if (existingAny?.id) {
          await supabase.from("item_favorites").update({ deleted_at: null }).eq("id", existingAny.id);
        } else {
          await supabase.from("item_favorites").insert({ user_id: user.id, item_id: targetItemId });
        }
      });
    },
    [likedSet, supabase, withLikeBusy],
  );

  const searchState = useMemo(
    () => ({
      search: "",
      sortMode: "recent" as const,
      heartsOnly: false,
      disponiblesOnly: false,
      filters: emptyShopCatalogFilters,
    }),
    [],
  );

  return (
    <div className="flex flex-col space-y-[4.5px] bg-zinc-100">
      {sectionOrder.map((sectionKey) => {
        if (sectionKey === HOME_HERO_SECTION_KEY) return null;

        let sectionContent: ReactNode = null;

        if (sectionKey === "home_system_nouveautes") {
          if (visibleNouveautes.length === 0) return null;
          const conf = nativeSectionConfigByKey[sectionKey];
          const title = conf?.title?.trim() || "Nouveautés";
          const sectionHref =
            conf?.show_more_arrow && conf.more_href?.trim() ? conf.more_href.trim() : "/shop/discover";
          sectionContent = (
            <ItemRailTwoUp
              title={title}
              hideSectionHeader={conf?.hide_section_title}
              items={visibleNouveautes}
              sectionHref={conf?.hide_section_title || !conf?.show_more_arrow ? undefined : sectionHref}
              coverUrlById={coverUrlById}
              shimmerDurationSec={SHIMMER_SEC}
              cartItemIds={cartItemIds}
              likedSet={likedSet}
              likeBusyIds={likeBusyIds}
              cartBusyIds={cartBusyIds}
              onToggleLike={handleToggleLike}
              onToggleCart={toggleCart}
              searchState={searchState}
              itemFromQuery="home"
              skipCatalogNavigationPersist
            />
          );
        } else if (sectionKey === "home_system_feed") {
          if (feedCards.length === 0) return null;
          const conf = nativeSectionConfigByKey[sectionKey];
          const title = conf?.title?.trim() || "Get the inspi";
          sectionContent = (
            <section className="space-y-4 px-3">
              {!conf?.hide_section_title ? (
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>{title}</h2>
                  <Link
                    href={createInspirationHref("/home")}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-3 text-[14px] font-bold text-zinc-900 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6A54]/35"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                    <span>Nouveau look</span>
                  </Link>
                </div>
              ) : null}
              <InspirationMasonryGrid cards={feedCards} compact shimmerDurationSec={SHIMMER_SEC} />
            </section>
          );
        } else if (!HOME_NATIVE_SECTION_KEYS.has(sectionKey)) {
          const bundle = cmsSectionsByKey[sectionKey];
          if (!bundle || bundle.frames.length === 0) return null;
          sectionContent = (
            <HomeCmsSectionBlock
              sectionKey={sectionKey}
              bundle={bundle}
              catalogItems={cmsCatalogItems}
              initialCoverUrlById={coverUrlById}
            />
          );
        }

        if (sectionContent == null) return null;

        return (
          <div key={sectionKey} className="bg-white py-4">
            {sectionContent}
          </div>
        );
      })}
    </div>
  );
}
