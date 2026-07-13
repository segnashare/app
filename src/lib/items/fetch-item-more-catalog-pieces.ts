import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

const ITEM_MORE_CATALOG_LIMIT = 20;

export async function fetchItemMoreCatalogPieces(
  supabase: StorageSignClient,
  itemId: string,
  limit = ITEM_MORE_CATALOG_LIMIT,
): Promise<ShopCatalogItem[]> {
  const id = itemId.trim();
  if (!id) return [];

  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await rpc.rpc("get_item_more_catalog_pieces_v1", {
    p_item_id: id,
    p_limit: limit,
  });

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    if (process.env.NODE_ENV === "development" && error?.message) {
      console.info("[ItemMoreCatalog] get_item_more_catalog_pieces_v1:", error.message);
    }
    return [];
  }

  const raw = (data as { items?: unknown }).items;
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (row): row is ShopCatalogItem =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as ShopCatalogItem).id === "string" &&
      typeof (row as ShopCatalogItem).title === "string",
  );
}
