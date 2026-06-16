"use client";

import { useCallback, useEffect, useRef } from "react";

import { InspirationCard } from "@/components/community/InspirationCard";
import type { InspirationFeedCard } from "@/lib/community/types";
import { cn } from "@/lib/utils/cn";

type InspirationMasonryGridProps = {
  cards: InspirationFeedCard[];
  className?: string;
  onImpression?: (card: InspirationFeedCard) => void;
  compact?: boolean;
};

export function InspirationMasonryGrid({
  cards,
  className,
  onImpression,
  compact = false,
}: InspirationMasonryGridProps) {
  const seenRef = useRef(new Set<string>());

  const handleImpression = useCallback(
    (card: InspirationFeedCard) => {
      const key = `${card.source}:${card.id}`;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      onImpression?.(card);
    },
    [onImpression],
  );

  useEffect(() => {
    seenRef.current.clear();
  }, [cards]);

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-12 text-center text-[15px] text-zinc-500">
        Aucune inspiration pour le moment. Reviens bientôt ou crée la tienne.
      </div>
    );
  }

  return (
    <div className={cn("columns-2 gap-3 [column-fill:balance]", className)}>
      {cards.map((card) => (
        <div key={`${card.source}:${card.id}`} className="mb-3">
          <InspirationCard card={card} onImpression={handleImpression} compact={compact} />
        </div>
      ))}
    </div>
  );
}
