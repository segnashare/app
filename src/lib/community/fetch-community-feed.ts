import { parseCommunityFeedPayload } from "@/lib/community/parse-community-rpc";
import type { CommunityFeedMode, CommunityFeedPayload } from "@/lib/community/types";

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function fetchCommunityFeed(
  supabase: unknown,
  options?: {
    mode?: CommunityFeedMode;
    limit?: number;
    cursor?: { score: number; source: string; id: string } | null;
  },
): Promise<CommunityFeedPayload> {
  const rpc = supabase as RpcClient;
  const { data, error } = await rpc.rpc("get_community_feed_v1", {
    p_mode: options?.mode ?? "explorer",
    p_limit: options?.limit ?? 20,
    p_cursor_score: options?.cursor?.score ?? null,
    p_cursor_source: options?.cursor?.source ?? null,
    p_cursor_id: options?.cursor?.id ?? null,
  });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.info("[Community] get_community_feed_v1:", error.message ?? error);
    }
    return { cards: [], next_cursor: null };
  }

  return parseCommunityFeedPayload(data);
}
