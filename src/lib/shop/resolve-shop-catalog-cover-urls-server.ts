import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import {
  createSignedUrlForStoragePath,
  createSignedUrlsForStoragePaths,
  normalizeStorageObjectPath,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";

const PATH_CHUNK = 40;

/**
 * Résout les URLs signées des couvertures catalogue côté serveur (session ou client admin démo).
 * Évite les courses / annulations côté client et les limites de requêtes concurrentes du navigateur.
 */
export async function resolveShopCatalogCoverUrlsServer(
  supabase: StorageSignClient,
  items: ShopCatalogItem[],
  expiresInSec = 60 * 60 * 24,
): Promise<Record<string, string>> {
  const pathByItemId = new Map<string, string>();
  for (const item of items) {
    const path = getFirstPhotoStoragePath(item.photos);
    if (!path) continue;
    pathByItemId.set(item.id, path);
  }
  if (pathByItemId.size === 0) return {};

  const uniquePaths = [...new Set(pathByItemId.values())];
  const signedByPath = new Map<string, string>();
  for (let i = 0; i < uniquePaths.length; i += PATH_CHUNK) {
    const chunk = uniquePaths.slice(i, i + PATH_CHUNK);
    const partial = await createSignedUrlsForStoragePaths(supabase, chunk, expiresInSec);
    for (const [k, v] of partial) {
      if (v) signedByPath.set(k, v);
    }
  }

  const out: Record<string, string> = {};
  for (const [id, path] of pathByItemId) {
    const url = signedByPath.get(path) ?? signedByPath.get(normalizeStorageObjectPath(path));
    if (url) out[id] = url;
  }

  for (const [id, path] of pathByItemId) {
    if (out[id]) continue;
    const single = await createSignedUrlForStoragePath(supabase, path, expiresInSec);
    if (single) out[id] = single;
  }

  return out;
}
