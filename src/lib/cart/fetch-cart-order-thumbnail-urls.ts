import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import {
  createSignedUrlsForStoragePaths,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- client query builder (comme fetch-active-cart-lines)
type CartOrderThumbSupabase = { from: (t: string) => any } & StorageSignClient;

/**
 * Première photo de chaque ligne de panier, dans l’ordre des lignes (pour cartes « commande » Échange).
 */
export async function fetchSignedFirstPhotoUrlsByCartIds(
  supabase: CartOrderThumbSupabase,
  cartIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of cartIds) out.set(id, []);
  if (cartIds.length === 0) return out;

  const cartItemsRes = await supabase
    .from("cart_items")
    .select("cart_id,item_id,created_at")
    .in("cart_id", cartIds)
    .is("deleted_at", null)
    .order("cart_id", { ascending: true })
    .order("created_at", { ascending: true });

  const rows = (cartItemsRes.data ?? []) as { cart_id: string; item_id: string }[];
  const itemIds = [...new Set(rows.map((r) => r.item_id))];

  let itemsMap = new Map<string, { photos?: unknown | null }>();
  if (itemIds.length > 0) {
    const itemsRes = await supabase.from("items").select("id,photos").in("id", itemIds);
    itemsMap = new Map(
      (itemsRes.data ?? []).map((item: { id: string; photos?: unknown | null }) => [item.id, item]),
    );
  }

  const pathsToSign = new Set<string>();
  const rawPathsByCart = new Map<string, string[]>();
  for (const id of cartIds) rawPathsByCart.set(id, []);

  for (const row of rows) {
    const item = itemsMap.get(row.item_id);
    const path = getFirstPhotoStoragePath(item?.photos ?? null);
    if (!path) continue;
    if (!isHttpUrl(path)) pathsToSign.add(path);
    rawPathsByCart.get(row.cart_id)?.push(path);
  }

  const signedByPath = await createSignedUrlsForStoragePaths(supabase, [...pathsToSign], 60 * 60 * 24);

  for (const id of cartIds) {
    const urls = (rawPathsByCart.get(id) ?? [])
      .map((p) => (isHttpUrl(p) ? p : signedByPath.get(p) ?? null))
      .filter((u): u is string => u != null);
    out.set(id, urls);
  }

  return out;
}
