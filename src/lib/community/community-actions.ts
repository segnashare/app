import type { InspirationMediaType, InspirationSource } from "@/lib/community/types";

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function toggleInspirationLike(
  supabase: unknown,
  source: InspirationSource,
  inspirationId: string,
): Promise<{ liked: boolean; like_count: number } | null> {
  const rpc = supabase as RpcClient;
  const { data, error } = await rpc.rpc("toggle_inspiration_like", {
    p_source: source,
    p_inspiration_id: inspirationId,
  });
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  return {
    liked: row.liked === true,
    like_count: typeof row.like_count === "number" ? row.like_count : 0,
  };
}

export async function toggleMemberFollow(
  supabase: unknown,
  followingUserId: string,
): Promise<{ following: boolean } | null> {
  const rpc = supabase as RpcClient;
  const { data, error } = await rpc.rpc("toggle_member_follow", {
    p_following_user_id: followingUserId,
  });
  if (error || !data || typeof data !== "object") return null;
  return { following: (data as Record<string, unknown>).following === true };
}

export async function publishCommunityInspiration(
  supabase: unknown,
  payload: {
    inspirationId?: string | null;
    title?: string;
    caption?: string;
    mediaType: InspirationMediaType;
    mediaBucket?: string;
    mediaPaths: string[];
    videoPosterPath?: string | null;
    itemIds: string[];
    roleLabels?: string[];
  },
): Promise<{ id: string } | null> {
  const rpc = supabase as RpcClient;
  const { data, error } = await rpc.rpc("publish_community_inspiration", {
    p_inspiration_id: payload.inspirationId ?? null,
    p_title: payload.title ?? "",
    p_caption: payload.caption ?? "",
    p_media_type: payload.mediaType,
    p_media_bucket: payload.mediaBucket ?? "bucket_community",
    p_media_paths: payload.mediaPaths,
    p_video_poster_path: payload.videoPosterPath ?? null,
    p_item_ids: payload.itemIds,
    p_role_labels: payload.roleLabels ?? [],
  });

  if (error || !data || typeof data !== "object") {
    if (process.env.NODE_ENV === "development" && error?.message) {
      console.info("[Community] publish_community_inspiration:", error.message);
    }
    return null;
  }

  const id = (data as Record<string, unknown>).id;
  return typeof id === "string" ? { id } : null;
}

export async function reportCommunityInspiration(
  supabase: unknown,
  source: InspirationSource,
  inspirationId: string,
  reason: string,
  details?: string,
): Promise<boolean> {
  const rpc = supabase as RpcClient;
  const { error } = await rpc.rpc("report_community_inspiration", {
    p_source: source,
    p_inspiration_id: inspirationId,
    p_reason: reason,
    p_details: details ?? null,
  });
  return !error;
}

export async function recordInspirationImpression(
  supabase: unknown,
  source: InspirationSource,
  inspirationId: string,
): Promise<void> {
  const rpc = supabase as RpcClient;
  await rpc.rpc("record_member_inspiration_impression", {
    p_source: source,
    p_inspiration_id: inspirationId,
    p_feed_surface: "community_v1",
  });
}
