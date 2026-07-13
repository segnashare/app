import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";

type QueryResult = { data: unknown; error?: { message?: string } | null };
type QueryBuilder = PromiseLike<QueryResult> & {
  eq: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, values: readonly unknown[]) => QueryBuilder;
  is: (column: string, value: null) => QueryBuilder;
  or: (filters: string) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
};
type TableClient = { select: (columns: string) => QueryBuilder };
type WornItemsSupabase = { from: (table: string) => TableClient };

function parseItemIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return [
    ...new Set(
      rows
        .map((row) => {
          if (!row || typeof row !== "object") return "";
          const itemId = (row as { item_id?: unknown }).item_id;
          return typeof itemId === "string" ? itemId.trim() : "";
        })
        .filter(Boolean),
    ),
  ];
}

/** Pièces empruntées (locations confirmées / archivées) du membre — pour tagger une inspi. */
export async function fetchMemberWornCatalogItems(
  supabase: unknown,
  userId: string,
): Promise<ShopCatalogItem[]> {
  const id = userId.trim();
  if (!id) return [];

  const client = supabase as WornItemsSupabase;

  const cartsRes = await client
    .from("carts")
    .select("id")
    .eq("user_id", id)
    .in("status", ["confirmed", "archived"])
    .or("checkout_purchase_mode.is.null,checkout_purchase_mode.eq.false")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(24);

  const cartIds = (Array.isArray(cartsRes.data) ? cartsRes.data : [])
    .map((row) => (row && typeof row === "object" ? (row as { id?: unknown }).id : null))
    .filter((cartId): cartId is string => typeof cartId === "string" && cartId.trim().length > 0);

  if (cartIds.length === 0) return [];

  const cartItemsRes = await client
    .from("cart_items")
    .select("item_id")
    .in("cart_id", cartIds)
    .is("deleted_at", null)
    .limit(120);

  const itemIds = parseItemIds(cartItemsRes.data);
  if (itemIds.length === 0) return [];

  const items = await fetchShopCatalogItemsByIds(supabase as Parameters<typeof fetchShopCatalogItemsByIds>[0], itemIds);
  const order = new Map(itemIds.map((itemId, index) => [itemId, index]));
  return [...items].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}
