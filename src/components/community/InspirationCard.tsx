"use client";

import Link from "next/link";
import { Copy, Heart } from "lucide-react";
import { useEffect, useRef } from "react";

import { InspirationFeedCardLikeButton } from "@/components/community/InspirationFeedCardLikeButton";
import { InspirationMediaViewer } from "@/components/community/InspirationMediaViewer";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { inspirationHref } from "@/lib/community/community-source";
import { inspirationMemberTag } from "@/lib/community/inspiration-member-tag";
import { inspirationCoverAspectClass } from "@/lib/community/inspiration-cover-aspect";
import type { InspirationFeedCard } from "@/lib/community/types";
import { cn } from "@/lib/utils/cn";

type InspirationCardProps = {
  card: InspirationFeedCard;
  className?: string;
  onImpression?: (card: InspirationFeedCard) => void;
  onLikeChange?: (liked: boolean) => void;
  compact?: boolean;
  shimmerDurationSec?: number;
  /** Sur le profil perso : afficher le total de likes au lieu du bouton like. */
  likeMode?: "button" | "count";
};

function InspirationCardLikeCount({ count }: { count: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
      <Heart className="h-4 w-4 fill-white" strokeWidth={2} aria-hidden />
      {count}
    </span>
  );
}

function InspirationCardPhotoOverlays({
  card,
  onLikeChange,
  showLike,
  likeMode = "button",
}: {
  card: InspirationFeedCard;
  onLikeChange?: (liked: boolean) => void;
  showLike?: boolean;
  likeMode?: "button" | "count";
}) {
  const memberTag = inspirationMemberTag(card.author_display_name, card.author_instagram_username);
  const multiPhoto = card.media_type === "dump" || (card.media_paths?.length ?? 0) > 1;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/50 via-black/20 to-transparent" />
      {multiPhoto ? (
        <Copy
          className="absolute right-2.5 top-2.5 h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
          strokeWidth={2.25}
          aria-hidden
        />
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
        <span className="min-w-0 truncate text-[11px] font-semibold leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
          {memberTag}
        </span>
        {showLike ? (
          likeMode === "count" ? (
            <InspirationCardLikeCount count={card.like_count} />
          ) : (
            <InspirationFeedCardLikeButton
              source={card.source}
              inspirationId={card.id}
              initialLiked={card.is_liked}
              onLikeChange={onLikeChange}
            />
          )
        ) : null}
      </div>
    </div>
  );
}

export function InspirationCard({
  card,
  className,
  onImpression,
  onLikeChange,
  compact = false,
  shimmerDurationSec,
  likeMode = "button",
}: InspirationCardProps) {
  const href = inspirationHref(card.source, card.id);
  const mediaUrls = card.media_urls ?? [];
  const coverUrl =
    card.media_type === "video" ? card.poster_url ?? mediaUrls[0] ?? null : mediaUrls[0] ?? null;
  const impressedRef = useRef(false);

  useEffect(() => {
    if (impressedRef.current) return;
    impressedRef.current = true;
    onImpression?.(card);
  }, [card, onImpression]);

  return (
    <Link
      href={href}
      className={cn("group block break-inside-avoid overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200/80", className)}
    >
      {coverUrl ? (
        <div className="relative">
          <InspirationMediaViewer
            key={`${card.source}:${card.id}`}
            mediaType={card.media_type}
            mediaUrls={mediaUrls.length > 0 ? mediaUrls : coverUrl ? [coverUrl] : []}
            posterUrl={card.poster_url}
            coverAspect={card.cover_aspect}
            coverTransform={card.cover_transform}
            className="rounded-none"
            shimmerDurationSec={shimmerDurationSec}
          />
          {compact ? (
            <InspirationCardPhotoOverlays
              card={card}
              onLikeChange={onLikeChange}
              showLike
              likeMode={likeMode}
            />
          ) : null}
        </div>
      ) : (
        <div className={cn("relative w-full", inspirationCoverAspectClass(card.cover_aspect))}>
          <SegnaSkeletonBlock className="absolute inset-0 h-full w-full" rounded="rounded-none" shimmerDurationSec={shimmerDurationSec} />
          {compact ? (
            <InspirationCardPhotoOverlays
              card={card}
              onLikeChange={onLikeChange}
              showLike
              likeMode={likeMode}
            />
          ) : null}
        </div>
      )}
      {!compact ? (
        <div className="space-y-1.5 p-3">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-900">{card.title}</p>
          <div className="flex items-center justify-between gap-2 text-[12px] text-zinc-500">
            <span className="truncate">
              {inspirationMemberTag(card.author_display_name, card.author_instagram_username)}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-zinc-500">
              <Heart
                className={cn(
                  "h-3.5 w-3.5",
                  card.is_liked ? "fill-zinc-900 text-zinc-900" : "fill-none text-zinc-500",
                )}
                strokeWidth={2}
                aria-hidden
              />
              {card.like_count}
            </span>
          </div>
          {card.linked_item_count > 0 ? (
            <p className="text-[11px] text-zinc-400">{card.linked_item_count} pièce{card.linked_item_count > 1 ? "s" : ""}</p>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
