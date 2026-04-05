import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

/**
 * Charge des pièces catalogue par UUID (même forme que get_shop_catalog_items), pour résoudre les refs CMS.
 */
export async function fetchShopCatalogItemsByIds(
  supabase: StorageSignClient,
  itemIds: string[],
): Promise<ShopCatalogItem[]> {
  const ids = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await rpc.rpc("get_shop_catalog_items_by_ids", { p_item_ids: ids });
  if (error) {
    if (process.env.NODE_ENV === "development") {
      const msg = error.message ?? "";
      const missing =
        msg.includes("Could not find the function") ||
        msg.includes("schema cache") ||
        /PGRST202|42883/i.test(msg);
      if (missing) {
        console.info(
          "[Shop] RPC get_shop_catalog_items_by_ids absente — appliquer la migration 20260507130000_cms_guest_fallback_shop_items_by_ids.sql.",
        );
      } else {
        console.error("get_shop_catalog_items_by_ids", msg);
      }
    }
    return [];
  }

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
