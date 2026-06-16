export type InspirationSource = "segna_style" | "member";
export type InspirationMediaType = "photo" | "video" | "dump";
export type CommunityFeedMode = "explorer" | "pour_toi";

/** URL segment: segna | member */
export type InspirationUrlSource = "segna" | "member";

export type InspirationFeedCard = {
  source: InspirationSource;
  id: string;
  title: string;
  caption: string;
  media_type: InspirationMediaType;
  media_bucket: string;
  media_paths: string[];
  video_poster_path: string | null;
  author_user_id: string | null;
  author_display_name: string;
  author_avatar_path: string | null;
  like_count: number;
  is_liked: boolean;
  linked_item_count: number;
  preview_item_ids: string[];
  published_at: string | null;
  score?: number;
  /** Client-only signed URLs */
  media_urls?: string[];
  poster_url?: string | null;
  author_avatar_url?: string | null;
};

export type InspirationCompanionRef = {
  item_id: string;
  role_label: string | null;
  sort_order: number;
};

export type InspirationTagRef = {
  id: string;
  label: string;
  category: string;
};

export type InspirationDetail = {
  source: InspirationSource;
  id: string;
  title: string;
  caption: string;
  tags: InspirationTagRef[];
  media_type: InspirationMediaType;
  media_bucket: string;
  media_paths: string[];
  video_poster_path: string | null;
  author_user_id: string | null;
  author_display_name: string;
  author_avatar_path: string | null;
  like_count: number;
  is_liked: boolean;
  is_following_author: boolean;
  published_at: string | null;
  companions: InspirationCompanionRef[];
  item_ids: string[];
  media_urls?: string[];
  poster_url?: string | null;
  author_avatar_url?: string | null;
};

export type CommunityFeedCursor = {
  score: number;
  source: InspirationSource;
  id: string;
};

export type CommunityFeedPayload = {
  cards: InspirationFeedCard[];
  next_cursor: CommunityFeedCursor | null;
};
