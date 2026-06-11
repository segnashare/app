import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";

import { parseCartOutfitSuggestionsRpcData } from "@/lib/shop/fetch-cart-outfit-suggestions";

type UpsellRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/** Upsell checkout « Terminez votre commande » : catalogue (tous départements), taille membre, available, < 50 crédits, max 10. */
export async function fetchCartUpsellSuggestions(
  supabase: unknown,
  cartItemIds: string[],
  options?: { excludeItemIds?: string[]; limit?: number },
): Promise<ShopCatalogItem[]> {
  const ids = [...new Set(cartItemIds.map((id) => id.trim()).filter(Boolean))];
  const exclude = [...new Set((options?.excludeItemIds ?? ids).map((id) => id.trim()).filter(Boolean))];
  const limit = Math.max(1, Math.min(options?.limit ?? 10, 10));

  const rpc = supabase as UpsellRpcClient;

  const { data, error } = await rpc.rpc("get_cart_upsell_suggestions", {
    p_cart_item_ids: ids,
    p_exclude_item_ids: exclude,
    p_limit: limit,
  });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.info("[Cart] get_cart_upsell_suggestions:", error.message ?? error);
    }
    return [];
  }

  return parseCartOutfitSuggestionsRpcData(data).filter(
    (item) =>
      item.status === "available" &&
      typeof item.price_points === "number" &&
      !Number.isNaN(item.price_points) &&
      item.price_points < 50,
  );
}
