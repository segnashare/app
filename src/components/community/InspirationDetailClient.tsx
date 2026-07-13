"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CommunityReportButton } from "@/components/community/CommunityReportButton";
import { InspirationLikeButton } from "@/components/community/InspirationLikeButton";
import { InspirationLinkedItemsRail } from "@/components/community/InspirationLinkedItemsRail";
import { InspirationMasonryGrid } from "@/components/community/InspirationMasonryGrid";
import { InspirationMediaViewer } from "@/components/community/InspirationMediaViewer";
import { MemberFollowButton } from "@/components/community/MemberFollowButton";
import { fetchRelatedInspirations } from "@/lib/community/fetch-related-inspirations";
import { resolveInspirationCardsMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import type { InspirationDetail, InspirationFeedCard } from "@/lib/community/types";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type InspirationDetailClientProps = {
  detail: InspirationDetail;
  companionItems: ShopCatalogItem[];
  initialCoverUrlById?: Record<string, string>;
  initialFavoriteIds?: string[];
};

export function InspirationDetailClient({
  detail,
  companionItems,
  initialCoverUrlById = {},
  initialFavoriteIds = [],
}: InspirationDetailClientProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [related, setRelated] = useState<InspirationFeedCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cards = await fetchRelatedInspirations(supabase, detail.source, detail.id, 12);
      const resolved = await resolveInspirationCardsMediaUrls(supabase, cards);
      if (!cancelled) setRelated(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.id, detail.source, supabase]);

  const mediaUrls = detail.media_urls ?? [];

  return (
    <div className="space-y-6 pb-10">
      <Link href="/community" className="inline-flex items-center gap-1 text-[14px] font-medium text-zinc-700">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Communauté
      </Link>

      <InspirationMediaViewer
        mediaType={detail.media_type}
        mediaUrls={mediaUrls}
        posterUrl={detail.poster_url}
        coverAspect={detail.cover_aspect}
        coverTransform={detail.cover_transform}
        priority
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className={cn("text-xl font-semibold text-zinc-900", segnaPlayfairDisplay.className)}>{detail.title}</h1>
            {detail.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[13px] font-medium text-zinc-700"
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            ) : detail.caption ? (
              <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">{detail.caption}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {detail.author_user_id ? (
            <>
              <Link href={`/membre/${detail.author_user_id}`} className="text-[14px] font-medium text-zinc-900 underline-offset-2 hover:underline">
                {detail.author_display_name}
              </Link>
              <MemberFollowButton userId={detail.author_user_id} initialFollowing={detail.is_following_author} />
            </>
          ) : (
            <span className="text-[14px] font-medium text-zinc-900">{detail.author_display_name}</span>
          )}
          <InspirationLikeButton
            source={detail.source}
            inspirationId={detail.id}
            initialLiked={detail.is_liked}
            initialCount={detail.like_count}
          />
          <CommunityReportButton source={detail.source} inspirationId={detail.id} />
        </div>
      </div>

      <InspirationLinkedItemsRail
        companions={detail.companions}
        companionItems={companionItems}
        initialCoverUrlById={initialCoverUrlById}
        initialFavoriteIds={initialFavoriteIds}
      />

      {related.length > 0 ? (
        <section className="space-y-4">
          <h2 className={cn("text-lg font-semibold text-zinc-900", segnaPlayfairDisplay.className)}>Plus d’inspis</h2>
          <InspirationMasonryGrid cards={related} compact />
        </section>
      ) : null}
    </div>
  );
}
