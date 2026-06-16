import type {
  CommunityFeedCursor,
  CommunityFeedPayload,
  InspirationDetail,
  InspirationFeedCard,
  InspirationMediaType,
  InspirationSource,
} from "@/lib/community/types";

function parseMediaPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

function parseSource(raw: unknown): InspirationSource | null {
  if (raw === "segna_style" || raw === "member") return raw;
  return null;
}

function parseMediaType(raw: unknown): InspirationMediaType {
  if (raw === "video" || raw === "dump") return raw;
  return "photo";
}

export function parseInspirationFeedCard(raw: unknown): InspirationFeedCard | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const source = parseSource(row.source);
  const id = typeof row.id === "string" ? row.id : "";
  if (!source || !id) return null;

  return {
    source,
    id,
    title: typeof row.title === "string" ? row.title : "",
    caption: typeof row.caption === "string" ? row.caption : "",
    media_type: parseMediaType(row.media_type),
    media_bucket: typeof row.media_bucket === "string" ? row.media_bucket : "bucket_community",
    media_paths: parseMediaPaths(row.media_paths),
    video_poster_path: typeof row.video_poster_path === "string" ? row.video_poster_path : null,
    author_user_id: typeof row.author_user_id === "string" ? row.author_user_id : null,
    author_display_name: typeof row.author_display_name === "string" ? row.author_display_name : "Membre Segna",
    author_avatar_path: typeof row.author_avatar_path === "string" ? row.author_avatar_path : null,
    like_count: typeof row.like_count === "number" ? row.like_count : 0,
    is_liked: row.is_liked === true,
    linked_item_count: typeof row.linked_item_count === "number" ? row.linked_item_count : 0,
    preview_item_ids: Array.isArray(row.preview_item_ids)
      ? row.preview_item_ids.filter((v): v is string => typeof v === "string")
      : [],
    published_at: typeof row.published_at === "string" ? row.published_at : null,
    score: typeof row.score === "number" ? row.score : undefined,
  };
}

export function parseCommunityFeedPayload(data: unknown): CommunityFeedPayload {
  const root = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const cardsRaw = Array.isArray(root.cards) ? root.cards : [];
  const cards = cardsRaw.map(parseInspirationFeedCard).filter((c): c is InspirationFeedCard => c !== null);

  let next_cursor: CommunityFeedCursor | null = null;
  const cursorRaw = root.next_cursor;
  if (cursorRaw && typeof cursorRaw === "object" && !Array.isArray(cursorRaw)) {
    const c = cursorRaw as Record<string, unknown>;
    const source = parseSource(c.source);
    const id = typeof c.id === "string" ? c.id : "";
    const score = typeof c.score === "number" ? c.score : null;
    if (source && id && score !== null) {
      next_cursor = { source, id, score };
    }
  }

  return { cards, next_cursor };
}

export function parseInspirationDetail(data: unknown): InspirationDetail | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const source = parseSource(row.source);
  const id = typeof row.id === "string" ? row.id : "";
  if (!source || !id) return null;

  const companionsRaw = Array.isArray(row.companions) ? row.companions : [];
  const companions = companionsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const c = entry as Record<string, unknown>;
      const itemId = typeof c.item_id === "string" ? c.item_id : "";
      if (!itemId) return null;
      return {
        item_id: itemId,
        role_label: typeof c.role_label === "string" ? c.role_label : null,
        sort_order: typeof c.sort_order === "number" ? c.sort_order : 0,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const tagsRaw = Array.isArray(row.tags) ? row.tags : [];
  const tags = tagsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const t = entry as Record<string, unknown>;
      const id = typeof t.id === "string" ? t.id : "";
      if (!id) return null;
      return {
        id,
        label: typeof t.label === "string" ? t.label : "",
        category: typeof t.category === "string" ? t.category : "",
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return {
    source,
    id,
    title: typeof row.title === "string" ? row.title : "",
    caption: typeof row.caption === "string" ? row.caption : "",
    tags,
    media_type: parseMediaType(row.media_type),
    media_bucket: typeof row.media_bucket === "string" ? row.media_bucket : "bucket_community",
    media_paths: parseMediaPaths(row.media_paths),
    video_poster_path: typeof row.video_poster_path === "string" ? row.video_poster_path : null,
    author_user_id: typeof row.author_user_id === "string" ? row.author_user_id : null,
    author_display_name: typeof row.author_display_name === "string" ? row.author_display_name : "Membre Segna",
    author_avatar_path: typeof row.author_avatar_path === "string" ? row.author_avatar_path : null,
    like_count: typeof row.like_count === "number" ? row.like_count : 0,
    is_liked: row.is_liked === true,
    is_following_author: row.is_following_author === true,
    published_at: typeof row.published_at === "string" ? row.published_at : null,
    companions,
    item_ids: Array.isArray(row.item_ids) ? row.item_ids.filter((v): v is string => typeof v === "string") : [],
  };
}

export function parseInspirationFeedCardsFromRoot(data: unknown): InspirationFeedCard[] {
  const root = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const cardsRaw = Array.isArray(root.cards) ? root.cards : Array.isArray(data) ? data : [];
  return cardsRaw.map(parseInspirationFeedCard).filter((c): c is InspirationFeedCard => c !== null);
}
