import { parseInspirationDetail } from "@/lib/community/parse-community-rpc";
import type { InspirationDetail, InspirationSource } from "@/lib/community/types";

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function fetchInspirationDetail(
  supabase: unknown,
  source: InspirationSource,
  id: string,
): Promise<InspirationDetail | null> {
  const rpc = supabase as RpcClient;
  const { data, error } = await rpc.rpc("get_inspiration_detail_v1", {
    p_source: source,
    p_id: id,
  });

  if (error || data == null) {
    if (process.env.NODE_ENV === "development" && error?.message) {
      console.info("[Community] get_inspiration_detail_v1:", error.message);
    }
    return null;
  }

  return parseInspirationDetail(data);
}
