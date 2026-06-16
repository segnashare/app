"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommunityCreateButton } from "@/components/community/CommunityCreateButton";
import { InspirationMasonryGrid } from "@/components/community/InspirationMasonryGrid";
import { CommunityFeedModeToggle } from "@/components/community/CommunityFeedModeToggle";
import { recordInspirationImpression } from "@/lib/community/community-actions";
import { fetchCommunityFeed } from "@/lib/community/fetch-community-feed";
import { resolveInspirationCardsMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import type { CommunityFeedCursor, CommunityFeedMode, InspirationFeedCard } from "@/lib/community/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type CommunityFeedPageProps = {
  initialMode?: CommunityFeedMode;
  initialCards: InspirationFeedCard[];
  initialCursor: CommunityFeedCursor | null;
};

export function CommunityFeedPage({
  initialMode = "explorer",
  initialCards,
  initialCursor,
}: CommunityFeedPageProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mode, setMode] = useState<CommunityFeedMode>(initialMode);
  const [cards, setCards] = useState<InspirationFeedCard[]>(initialCards);
  const [cursor, setCursor] = useState<CommunityFeedCursor | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingMode, setLoadingMode] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const skippedInitialFetch = useRef(false);

  const loadFeed = useCallback(
    async (nextMode: CommunityFeedMode, nextCursor: CommunityFeedCursor | null, append: boolean) => {
      const payload = await fetchCommunityFeed(supabase, {
        mode: nextMode,
        limit: 20,
        cursor: nextCursor,
      });
      const resolved = await resolveInspirationCardsMediaUrls(supabase, payload.cards);
      setCards((prev) => (append ? [...prev, ...resolved] : resolved));
      setCursor(payload.next_cursor);
    },
    [supabase],
  );

  useEffect(() => {
    if (!skippedInitialFetch.current && mode === initialMode) {
      skippedInitialFetch.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingMode(true);
      await loadFeed(mode, null, false);
      if (!cancelled) setLoadingMode(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialMode, mode, loadFeed]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !cursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingMore || !cursor) return;
        setLoadingMore(true);
        void loadFeed(mode, cursor, true).finally(() => setLoadingMore(false));
      },
      { rootMargin: "240px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadFeed, loadingMore, mode]);

  const handleImpression = useCallback(
    (card: InspirationFeedCard) => {
      void recordInspirationImpression(supabase, card.source, card.id);
    },
    [supabase],
  );

  return (
    <>
      <div className="space-y-5 pb-28">
        <div className="flex items-center justify-between gap-3">
          <h1 className={cn(SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay.className)}>GET THE INSPI</h1>
          <CommunityCreateButton />
        </div>

        {loadingMode ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-zinc-400" aria-hidden />
          </div>
        ) : (
          <>
            <InspirationMasonryGrid cards={cards} onImpression={handleImpression} />
            <div ref={sentinelRef} className="flex justify-center py-6">
              {loadingMore ? <Loader2 className="h-6 w-6 animate-spin text-zinc-400" aria-hidden /> : null}
            </div>
          </>
        )}
      </div>

      <CommunityFeedModeToggle mode={mode} onModeChange={setMode} />
    </>
  );
}
