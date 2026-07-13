import { CommunityFeedPage } from "@/components/community/CommunityFeedPage";
import { MainContent } from "@/components/layout/MainContent";
import { fetchCommunityFeed } from "@/lib/community/fetch-community-feed";
import { resolveInspirationCardsMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CommunityPage() {
  const supabase = await createSupabaseServerClient();
  const payload = await fetchCommunityFeed(supabase, { mode: "explorer", limit: 20 });
  const cards = await resolveInspirationCardsMediaUrls(supabase, payload.cards);

  return (
    <MainContent>
      <CommunityFeedPage initialCards={cards} initialCursor={payload.next_cursor} />
    </MainContent>
  );
}
