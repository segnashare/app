import { parseInspirationFeedCardsFromRoot } from "@/lib/community/parse-community-rpc";
import type { InspirationFeedCard, InspirationSource } from "@/lib/community/types";

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function fetchRelatedInspirations(
  supabase: unknown,
  source: InspirationSource,
  id: string,
  limit = 12,
): Promise<InspirationFeedCard[]> {
  const rpc = supabase as RpcClient;
  const { data, error } = await rpc.rpc("get_related_inspirations_v1", {
    p_source: source,
    p_id: id,
    p_limit: limit,
  });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.info("[Community] get_related_inspirations_v1:", error.message ?? error);
    }
    return [];
  }

  return parseInspirationFeedCardsFromRoot(data);
}

export async function fetchMemberInspirations(
  supabase: unknown,
  authorUserId: string,
  limit = 12,
): Promise<InspirationFeedCard[]> {
  const rpc = supabase as RpcClient;
  const { data, error } = await rpc.rpc("get_member_inspirations_v1", {
    p_author_user_id: authorUserId,
    p_limit: limit,
  });

  if (error) return [];
  return parseInspirationFeedCardsFromRoot(data);
}
