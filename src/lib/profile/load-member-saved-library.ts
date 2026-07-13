import type { SupabaseClient } from "@supabase/supabase-js";

import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { parseInspirationFeedCard } from "@/lib/community/parse-community-rpc";
import { resolveInspirationCardsMediaUrls } from "@/lib/community/resolve-inspiration-media-urls";
import type { InspirationFeedCard, InspirationSource } from "@/lib/community/types";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import {
  createSignedUrlForStoragePath,
  createSignedUrlsForStoragePaths,
  normalizeStorageObjectPath,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";

export type MemberSavedLibraryEntry =
  | {
      kind: "item";
      key: string;
      savedAt: string;
      item: ShopCatalogItem;
      coverUrl?: string;
    }
  | {
      kind: "look";
      key: string;
      savedAt: string;
      card: InspirationFeedCard;
    };

type SavedRawRow =
  | { kind: "item"; savedAt: string; itemId: string }
  | { kind: "look"; savedAt: string; source: InspirationSource; inspirationId: string };

function parseMediaPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

async function resolveItemCoverUrls(
  supabase: StorageSignClient,
  items: ShopCatalogItem[],
): Promise<Record<string, string>> {
  const pathByItemId = new Map<string, string>();
  for (const item of items) {
    const path = getFirstPhotoStoragePath(item.photos);
    if (path) pathByItemId.set(item.id, path);
  }
  if (pathByItemId.size === 0) return {};

  const uniquePaths = [...new Set(pathByItemId.values())];
  const signedByPath = await createSignedUrlsForStoragePaths(supabase, uniquePaths, 60 * 60 * 24);

  const out: Record<string, string> = {};
  for (const [id, path] of pathByItemId) {
    const url =
      signedByPath.get(path) ??
      signedByPath.get(normalizeStorageObjectPath(path)) ??
      (await createSignedUrlForStoragePath(supabase, path, 60 * 60 * 24));
    if (url) out[id] = url;
  }
  return out;
}

async function fetchLookCardsByIds(
  supabase: SupabaseClient,
  rows: Array<{ source: InspirationSource; inspirationId: string }>,
): Promise<Map<string, InspirationFeedCard>> {
  const out = new Map<string, InspirationFeedCard>();
  if (rows.length === 0) return out;

  const segnaIds = rows.filter((r) => r.source === "segna_style").map((r) => r.inspirationId);
  const memberIds = rows.filter((r) => r.source === "member").map((r) => r.inspirationId);

  if (segnaIds.length > 0) {
    const { data } = await supabase
      .from("style_looks")
      .select(
        "id, title, intro, media_type, presentation_storage_bucket, media_paths, presentation_storage_path, video_poster_path, like_count, cover_aspect, cover_transform, featured_member_user_id",
      )
      .in("id", segnaIds)
      .eq("published", true);

    const featuredMemberIds = [
      ...new Set(
        (data ?? [])
          .map((row: { featured_member_user_id?: string | null }) =>
            typeof row.featured_member_user_id === "string" ? row.featured_member_user_id : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const profileByUserId = new Map<string, { displayName: string; instagram: string | null }>();
    if (featuredMemberIds.length > 0) {
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("user_id, display_name, profile_data")
        .in("user_id", featuredMemberIds)
        .is("deleted_at", null);
      for (const profile of profiles ?? []) {
        if (typeof profile.user_id !== "string") continue;
        const profileData =
          profile.profile_data && typeof profile.profile_data === "object" && !Array.isArray(profile.profile_data)
            ? (profile.profile_data as Record<string, unknown>)
            : {};
        const instagram =
          typeof profileData.instagram_username === "string" ? profileData.instagram_username.trim() : null;
        profileByUserId.set(profile.user_id, {
          displayName: typeof profile.display_name === "string" ? profile.display_name : "Membre Segna",
          instagram: instagram || null,
        });
      }
    }

    for (const row of data ?? []) {
      const featuredMemberId =
        typeof row.featured_member_user_id === "string" ? row.featured_member_user_id.trim() : null;
      const featuredProfile = featuredMemberId ? profileByUserId.get(featuredMemberId) : undefined;
      const mediaPaths = parseMediaPaths(row.media_paths);
      const fallbackPath =
        typeof row.presentation_storage_path === "string" ? row.presentation_storage_path.trim() : "";
      const paths = mediaPaths.length > 0 ? mediaPaths : fallbackPath ? [fallbackPath] : [];
      const card = parseInspirationFeedCard({
        source: "segna_style",
        id: row.id,
        title: row.title,
        caption: row.intro,
        media_type: row.media_type,
        media_bucket: row.presentation_storage_bucket,
        media_paths: paths,
        cover_aspect: row.cover_aspect,
        cover_transform: row.cover_transform,
        video_poster_path: row.video_poster_path,
        author_user_id: featuredMemberId,
        author_display_name: featuredMemberId ? featuredProfile?.displayName ?? "Membre Segna" : "Segna",
        author_instagram_username: featuredProfile?.instagram ?? null,
        like_count: row.like_count,
        is_liked: true,
        linked_item_count: 0,
        preview_item_ids: [],
      });
      if (card) out.set(`segna_style:${row.id}`, card);
    }
  }

  if (memberIds.length > 0) {
    const { data } = await supabase
      .from("community_inspirations")
      .select(
        "id, title, caption, media_type, media_bucket, media_paths, video_poster_path, author_user_id, like_count, cover_aspect, cover_transform",
      )
      .in("id", memberIds)
      .eq("status", "published")
      .is("deleted_at", null);

    const authorIds = [
      ...new Set(
        (data ?? [])
          .map((row: { author_user_id?: string | null }) =>
            typeof row.author_user_id === "string" ? row.author_user_id : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const displayNameByUserId = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", authorIds)
        .is("deleted_at", null);
      for (const profile of profiles ?? []) {
        if (typeof profile.user_id === "string" && typeof profile.display_name === "string") {
          displayNameByUserId.set(profile.user_id, profile.display_name);
        }
      }
    }

    for (const row of data ?? []) {
      const authorId = typeof row.author_user_id === "string" ? row.author_user_id : null;
      const card = parseInspirationFeedCard({
        source: "member",
        id: row.id,
        title: row.title,
        caption: row.caption,
        media_type: row.media_type,
        media_bucket: row.media_bucket,
        media_paths: parseMediaPaths(row.media_paths),
        cover_aspect: row.cover_aspect,
        cover_transform: row.cover_transform,
        video_poster_path: row.video_poster_path,
        author_user_id: authorId,
        author_display_name: authorId ? displayNameByUserId.get(authorId) ?? "Membre Segna" : "Membre Segna",
        like_count: row.like_count,
        is_liked: true,
        linked_item_count: 0,
        preview_item_ids: [],
      });
      if (card) out.set(`member:${row.id}`, card);
    }
  }

  const cards = [...out.values()];
  if (cards.length === 0) return out;

  const resolved = await resolveInspirationCardsMediaUrls(supabase, cards);
  const resolvedByKey = new Map(resolved.map((card) => [`${card.source}:${card.id}`, card]));
  return resolvedByKey;
}

export async function loadMemberSavedLibrary(
  supabase: SupabaseClient,
  userId: string,
): Promise<MemberSavedLibraryEntry[]> {
  const [favoritesRes, likesRes] = await Promise.all([
    supabase
      .from("item_favorites")
      .select("item_id, created_at, updated_at")
      .eq("user_id", userId)
      .is("deleted_at", null),
    supabase
      .from("inspiration_likes")
      .select("source, inspiration_id, created_at, updated_at")
      .eq("member_user_id", userId)
      .is("deleted_at", null),
  ]);

  const raw: SavedRawRow[] = [];

  for (const row of favoritesRes.data ?? []) {
    if (typeof row.item_id !== "string") continue;
    const savedAt =
      typeof row.updated_at === "string"
        ? row.updated_at
        : typeof row.created_at === "string"
          ? row.created_at
          : new Date(0).toISOString();
    raw.push({ kind: "item", savedAt, itemId: row.item_id });
  }

  for (const row of likesRes.data ?? []) {
    if (row.source !== "segna_style" && row.source !== "member") continue;
    if (typeof row.inspiration_id !== "string") continue;
    const savedAt =
      typeof row.updated_at === "string"
        ? row.updated_at
        : typeof row.created_at === "string"
          ? row.created_at
          : new Date(0).toISOString();
    raw.push({
      kind: "look",
      savedAt,
      source: row.source,
      inspirationId: row.inspiration_id,
    });
  }

  raw.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  const itemIds = [...new Set(raw.filter((row) => row.kind === "item").map((row) => row.itemId))];
  const lookKeys = raw
    .filter((row): row is Extract<SavedRawRow, { kind: "look" }> => row.kind === "look")
    .map((row) => ({ source: row.source, inspirationId: row.inspirationId }));

  const [items, lookCardsByKey] = await Promise.all([
    fetchShopCatalogItemsByIds(supabase, itemIds),
    fetchLookCardsByIds(supabase, lookKeys),
  ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const coverUrlById = await resolveItemCoverUrls(supabase, items);

  const entries: MemberSavedLibraryEntry[] = [];
  for (const row of raw) {
    if (row.kind === "item") {
      const item = itemById.get(row.itemId);
      if (!item) continue;
      entries.push({
        kind: "item",
        key: `item:${row.itemId}`,
        savedAt: row.savedAt,
        item,
        coverUrl: coverUrlById[row.itemId],
      });
      continue;
    }
    const card = lookCardsByKey.get(`${row.source}:${row.inspirationId}`);
    if (!card) continue;
    entries.push({
      kind: "look",
      key: `look:${row.source}:${row.inspirationId}`,
      savedAt: row.savedAt,
      card,
    });
  }

  return entries;
}
