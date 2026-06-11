import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";

export function parseCartOutfitSuggestionsRpcData(data: unknown): ShopCatalogItem[] {
  const root = data && typeof data === "object" && !Array.isArray(data) ? (data as { items?: unknown }) : {};
  const raw = root.items;
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (row): row is ShopCatalogItem =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as ShopCatalogItem).id === "string" &&
      typeof (row as ShopCatalogItem).title === "string",
  );
}

type OutfitRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function fetchCartOutfitSuggestions(
  supabase: unknown,
  cartItemIds: string[],
  options?: { excludeItemIds?: string[]; limit?: number },
): Promise<ShopCatalogItem[]> {
  const ids = [...new Set(cartItemIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const exclude = [...new Set((options?.excludeItemIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const limit = Math.max(1, Math.min(options?.limit ?? 10, 20));

  const rpc = supabase as OutfitRpcClient;

  const { data, error } = await rpc.rpc("get_cart_outfit_suggestions", {
    p_cart_item_ids: ids,
    p_exclude_item_ids: exclude,
    p_limit: limit,
  });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.info("[Cart] get_cart_outfit_suggestions:", error.message ?? error);
    }
    return [];
  }

  return parseCartOutfitSuggestionsRpcData(data);
}
