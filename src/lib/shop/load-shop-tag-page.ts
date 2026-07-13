import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";

export type CatalogTagPageMeta = {
  id: string;
  label: string;
  slug: string;
  page_kind: CatalogTagPageKind;
  page_slug: string;
};

export type CatalogTagPageKind = "shop" | "inspiration";

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function loadShopCatalogItemsByTagPageSlug(
  client: RpcClient,
  pageSlug: string,
  limit = 120,
): Promise<{ tag: CatalogTagPageMeta | null; items: ShopCatalogItem[] }> {
  const { data, error } = await client.rpc("get_shop_catalog_items_by_tag_page_slug", {
    p_page_slug: pageSlug,
    p_limit: limit,
  });
  if (error) throw new Error(error.message ?? "Chargement tag shop impossible");

  const root = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const tagRaw = root.tag;
  const tag =
    tagRaw && typeof tagRaw === "object" && !Array.isArray(tagRaw)
      ? (tagRaw as Record<string, unknown>)
      : null;

  const items = Array.isArray(root.items) ? (root.items as ShopCatalogItem[]) : [];

  if (!tag || typeof tag.id !== "string") {
    return { tag: null, items: [] };
  }

  return {
    tag: {
      id: tag.id,
      label: typeof tag.label === "string" ? tag.label : "",
      slug: typeof tag.slug === "string" ? tag.slug : "",
      page_kind: "shop",
      page_slug: typeof tag.page_slug === "string" ? tag.page_slug : pageSlug,
    },
    items,
  };
}
