import { parseInspirationFeedCardsFromRoot } from "@/lib/community/parse-community-rpc";
import type { InspirationFeedCard } from "@/lib/community/types";

export type CatalogTagPageMeta = {
  id: string;
  label: string;
  slug: string;
  page_kind: "inspiration";
  page_slug: string;
};

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function loadCommunityInspirationsByTagPageSlug(
  client: RpcClient,
  pageSlug: string,
  limit = 40,
): Promise<{ tag: CatalogTagPageMeta | null; cards: InspirationFeedCard[] }> {
  const { data, error } = await client.rpc("get_community_inspirations_by_tag_page_slug", {
    p_page_slug: pageSlug,
    p_limit: limit,
  });
  if (error) throw new Error(error.message ?? "Chargement tag inspiration impossible");

  const root = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const tagRaw = root.tag;
  const tag =
    tagRaw && typeof tagRaw === "object" && !Array.isArray(tagRaw)
      ? (tagRaw as Record<string, unknown>)
      : null;

  const cards = parseInspirationFeedCardsFromRoot({ cards: root.cards });

  if (!tag || typeof tag.id !== "string") {
    return { tag: null, cards: [] };
  }

  return {
    tag: {
      id: tag.id,
      label: typeof tag.label === "string" ? tag.label : "",
      slug: typeof tag.slug === "string" ? tag.slug : "",
      page_kind: "inspiration",
      page_slug: typeof tag.page_slug === "string" ? tag.page_slug : pageSlug,
    },
    cards,
  };
}
