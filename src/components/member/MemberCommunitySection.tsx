"use client";

import { useEffect, useMemo, useState } from "react";

import { InspirationMasonryGrid } from "@/components/community/InspirationMasonryGrid";
import { MemberFollowButton } from "@/components/community/MemberFollowButton";
import { fetchMemberInspirations } from "@/lib/community/fetch-related-inspirations";
import { resolveInspirationCardsMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import type { InspirationFeedCard } from "@/lib/community/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type MemberCommunitySectionProps = {
  userId: string;
  displayName: string;
};

export function MemberCommunitySection({ userId, displayName }: MemberCommunitySectionProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [cards, setCards] = useState<InspirationFeedCard[]>([]);
  const [following, setFollowing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user && user.id !== userId) {
        const { data: followRow } = await supabase
          .from("member_follows")
          .select("id")
          .eq("follower_user_id", user.id)
          .eq("following_user_id", userId)
          .is("deleted_at", null)
          .maybeSingle();
        if (!cancelled) setFollowing(Boolean(followRow?.id));
      }

      const raw = await fetchMemberInspirations(supabase, userId, 12);
      const resolved = await resolveInspirationCardsMediaUrls(supabase, raw);
      if (!cancelled) {
        setCards(resolved);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  if (!loaded) return null;
  if (cards.length === 0 && !following) {
    return (
      <section className="space-y-3 px-4 pb-8">
        <MemberFollowButton userId={userId} initialFollowing={following} className="w-full justify-center" />
      </section>
    );
  }

  return (
    <section className="space-y-4 px-4 pb-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn("text-lg font-semibold text-zinc-900", segnaPlayfairDisplay.className)}>
          Inspis de {displayName.split(" ")[0] ?? displayName}
        </h2>
        <MemberFollowButton userId={userId} initialFollowing={following} />
      </div>
      {cards.length > 0 ? <InspirationMasonryGrid cards={cards} compact /> : null}
    </section>
  );
}
