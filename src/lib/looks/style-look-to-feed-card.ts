import type { InspirationFeedCard } from "@/lib/community/types";
import type { ItemStyleLookSummary } from "@/lib/items/fetch-item-style-looks";

export function styleLookSummaryToFeedCard(look: ItemStyleLookSummary): InspirationFeedCard {
  return {
    source: "segna_style",
    id: look.id,
    title: look.title,
    caption: "",
    media_type: look.media_type,
    media_bucket: look.media_bucket,
    media_paths: look.media_paths,
    cover_aspect: look.cover_aspect,
    cover_transform: look.cover_transform,
    video_poster_path: look.video_poster_path,
    author_user_id: null,
    author_display_name: look.author_display_name,
    author_avatar_path: null,
    author_instagram_username: look.author_instagram_username,
    like_count: look.like_count,
    is_liked: look.is_liked,
    linked_item_count: 0,
    preview_item_ids: [],
    published_at: null,
    media_urls: look.media_urls,
    poster_url: look.poster_url,
  };
}
