import type { InspirationMediaType } from "@/lib/community/types";
import {
  parseInspirationCoverAspect,
  parseInspirationCoverTransform,
  type InspirationCoverAspect,
  type InspirationCoverTransform,
} from "@/lib/community/inspiration-cover-aspect";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";
import {
  createSignedUrlForStoragePath,
  createSignedUrlsForStoragePaths,
  normalizeStorageObjectPath,
} from "@/lib/supabase/storage-resolve-signed-url";

export type ItemStyleLookSummary = {
  id: string;
  title: string;
  media_type: InspirationMediaType;
  media_bucket: string;
  media_paths: string[];
  media_urls: string[];
  poster_url: string | null;
  video_poster_path: string | null;
  cover_aspect: InspirationCoverAspect;
  cover_transform: InspirationCoverTransform | null;
  author_display_name: string;
  author_instagram_username: string | null;
  like_count: number;
  is_liked: boolean;
};

type StyleLookRpcRow = {
  id?: unknown;
  title?: unknown;
  media_type?: unknown;
  media_bucket?: unknown;
  media_paths?: unknown;
  video_poster_path?: unknown;
  cover_aspect?: unknown;
  cover_transform?: unknown;
  author_display_name?: unknown;
  author_instagram_username?: unknown;
  like_count?: unknown;
  is_liked?: unknown;
};

function parseMediaType(value: unknown): InspirationMediaType {
  if (value === "video" || value === "dump") return value;
  return "photo";
}

function parseMediaPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

async function signLookMedia(
  supabase: StorageSignClient,
  row: StyleLookRpcRow,
): Promise<ItemStyleLookSummary | null> {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;

  const mediaType = parseMediaType(row.media_type);
  const bucket =
    typeof row.media_bucket === "string" && row.media_bucket.trim()
      ? row.media_bucket.trim()
      : "bucket_cms_app";
  const mediaPaths = parseMediaPaths(row.media_paths);

  const signedByPath = await createSignedUrlsForStoragePaths(
    supabase,
    mediaPaths.map(normalizeStorageObjectPath).filter(Boolean),
    60 * 60 * 24,
    { explicitBucket: bucket },
  );

  const media_urls = mediaPaths
    .map((path) => signedByPath.get(normalizeStorageObjectPath(path)) ?? null)
    .filter((url): url is string => Boolean(url));

  let poster_url: string | null = null;
  if (typeof row.video_poster_path === "string" && row.video_poster_path.trim()) {
    const normalized = normalizeStorageObjectPath(row.video_poster_path);
    if (normalized) {
      poster_url = await createSignedUrlForStoragePath(supabase, normalized, 60 * 60 * 24, {
        explicitBucket: bucket,
      });
    }
  } else if (mediaType === "video" && media_urls[0]) {
    poster_url = media_urls[0];
  }

  if (media_urls.length === 0 && !poster_url) return null;

  return {
    id,
    title: typeof row.title === "string" ? row.title : "",
    media_type: mediaType,
    media_bucket: bucket,
    media_paths: mediaPaths,
    media_urls,
    poster_url,
    video_poster_path:
      typeof row.video_poster_path === "string" && row.video_poster_path.trim()
        ? row.video_poster_path.trim()
        : null,
    cover_aspect: parseInspirationCoverAspect(row.cover_aspect),
    cover_transform: parseInspirationCoverTransform(row.cover_transform),
    author_display_name:
      typeof row.author_display_name === "string" ? row.author_display_name : "Segna",
    author_instagram_username:
      typeof row.author_instagram_username === "string" ? row.author_instagram_username : null,
    like_count: typeof row.like_count === "number" ? row.like_count : 0,
    is_liked: row.is_liked === true,
  };
}

export async function fetchItemStyleLooks(
  supabase: StorageSignClient,
  itemId: string,
): Promise<ItemStyleLookSummary[]> {
  const id = itemId.trim();
  if (!id) return [];

  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await rpc.rpc("get_item_style_looks_v1", { p_item_id: id });
  if (error || !Array.isArray(data)) {
    if (process.env.NODE_ENV === "development" && error?.message) {
      console.info("[StyleLooks] get_item_style_looks_v1:", error.message);
    }
    return [];
  }

  const looks: ItemStyleLookSummary[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const signed = await signLookMedia(supabase, entry as StyleLookRpcRow);
    if (signed) looks.push(signed);
  }

  return looks;
}

export async function fetchHomeStyleLooks(
  supabase: StorageSignClient,
  limit = 24,
): Promise<ItemStyleLookSummary[]> {
  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await rpc.rpc("get_home_style_looks_v1", { p_limit: limit });
  if (error || !Array.isArray(data)) {
    if (process.env.NODE_ENV === "development" && error?.message) {
      console.info("[StyleLooks] get_home_style_looks_v1:", error.message);
    }
    return [];
  }

  const looks: ItemStyleLookSummary[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const signed = await signLookMedia(supabase, entry as StyleLookRpcRow);
    if (signed) looks.push(signed);
  }

  return looks;
}

export async function fetchLookRelatedStyleLooks(
  supabase: StorageSignClient,
  lookId: string,
): Promise<ItemStyleLookSummary[]> {
  const id = lookId.trim();
  if (!id) return [];

  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await rpc.rpc("get_look_related_style_looks_v1", { p_look_id: id });
  if (error || !Array.isArray(data)) {
    if (process.env.NODE_ENV === "development" && error?.message) {
      console.info("[StyleLooks] get_look_related_style_looks_v1:", error.message);
    }
    return [];
  }

  const looks: ItemStyleLookSummary[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const signed = await signLookMedia(supabase, entry as StyleLookRpcRow);
    if (signed) looks.push(signed);
  }

  return looks;
}
