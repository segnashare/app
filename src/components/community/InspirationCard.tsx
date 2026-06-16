"use client";

import Link from "next/link";
import { Heart, Play } from "lucide-react";
import { useEffect, useRef } from "react";

import { InspirationMediaViewer } from "@/components/community/InspirationMediaViewer";
import { inspirationHref } from "@/lib/community/community-source";
import type { InspirationFeedCard } from "@/lib/community/types";
import { cn } from "@/lib/utils/cn";

type InspirationCardProps = {
  card: InspirationFeedCard;
  className?: string;
  onImpression?: (card: InspirationFeedCard) => void;
  compact?: boolean;
};

export function InspirationCard({ card, className, onImpression, compact = false }: InspirationCardProps) {
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
            mediaType="photo"
            mediaUrls={[coverUrl]}
            posterUrl={card.poster_url}
            className="rounded-none"
          />
          {card.media_type === "video" ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white">
                <Play className="h-5 w-5 fill-current" aria-hidden />
              </span>
            </span>
          ) : null}
          {card.media_type === "dump" && card.media_paths.length > 1 ? (
            <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white">
              Dump
            </span>
          ) : null}
        </div>
      ) : (
        <div className="aspect-[3/4] w-full bg-zinc-100" />
      )}
      {!compact ? (
        <div className="space-y-1.5 p-3">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-900">{card.title}</p>
          <div className="flex items-center justify-between gap-2 text-[12px] text-zinc-500">
            <span className="truncate">{card.author_display_name}</span>
            <span className="inline-flex shrink-0 items-center gap-1">
              <Heart className={cn("h-3.5 w-3.5", card.is_liked && "fill-rose-500 text-rose-500")} aria-hidden />
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
