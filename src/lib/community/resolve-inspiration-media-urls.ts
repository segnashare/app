import type { InspirationDetail, InspirationFeedCard } from "@/lib/community/types";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";
import {
  createSignedUrlForStoragePath,
  createSignedUrlsForStoragePaths,
  normalizeStorageObjectPath,
} from "@/lib/supabase/storage-resolve-signed-url";

async function signPath(
  supabase: StorageSignClient,
  bucket: string,
  path: string,
): Promise<string | null> {
  const normalized = normalizeStorageObjectPath(path);
  if (!normalized) return null;
  return createSignedUrlForStoragePath(supabase, normalized, 60 * 60 * 24, { explicitBucket: bucket });
}

export async function resolveInspirationCardMediaUrls(
  supabase: StorageSignClient,
  card: InspirationFeedCard,
): Promise<InspirationFeedCard> {
  const bucket = card.media_bucket || "bucket_community";
  const signedByPath = await createSignedUrlsForStoragePaths(
    supabase,
    card.media_paths.map(normalizeStorageObjectPath).filter(Boolean),
    60 * 60 * 24,
    { explicitBucket: bucket },
  );

  const media_urls = card.media_paths
    .map((p) => signedByPath.get(normalizeStorageObjectPath(p)) ?? null)
    .filter((u): u is string => Boolean(u));

  let poster_url: string | null = null;
  if (card.video_poster_path) {
    poster_url = await signPath(supabase, bucket, card.video_poster_path);
  } else if (card.media_type === "video" && media_urls[0]) {
    poster_url = media_urls[0];
  }

  let author_avatar_url: string | null = null;
  if (card.author_avatar_path) {
    author_avatar_url = await signPath(supabase, "bucket_focus", card.author_avatar_path);
  }

  return { ...card, media_urls, poster_url, author_avatar_url };
}

export async function resolveInspirationDetailMediaUrls(
  supabase: StorageSignClient,
  detail: InspirationDetail,
): Promise<InspirationDetail> {
  const bucket = detail.media_bucket || "bucket_community";
  const signedByPath = await createSignedUrlsForStoragePaths(
    supabase,
    detail.media_paths.map(normalizeStorageObjectPath).filter(Boolean),
    60 * 60 * 24,
    { explicitBucket: bucket },
  );

  const media_urls = detail.media_paths
    .map((p) => signedByPath.get(normalizeStorageObjectPath(p)) ?? null)
    .filter((u): u is string => Boolean(u));

  let poster_url: string | null = null;
  if (detail.video_poster_path) {
    poster_url = await signPath(supabase, bucket, detail.video_poster_path);
  }

  let author_avatar_url: string | null = null;
  if (detail.author_avatar_path) {
    author_avatar_url = await signPath(supabase, "bucket_focus", detail.author_avatar_path);
  }

  return { ...detail, media_urls, poster_url, author_avatar_url };
}

export async function resolveInspirationCardsMediaUrls(
  supabase: StorageSignClient,
  cards: InspirationFeedCard[],
): Promise<InspirationFeedCard[]> {
  return Promise.all(cards.map((card) => resolveInspirationCardMediaUrls(supabase, card)));
}
