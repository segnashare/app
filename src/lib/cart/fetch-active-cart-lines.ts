import type { CartLineRowData } from "@/components/cart/CartScreen";
import type { CartLineStatus } from "@/components/exchange/ExchangeCartSection";
import { sortCartLinesByPriceAsc } from "@/lib/cart/sort-cart-lines-by-price";
import {
  createSignedUrlForStoragePath,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";

function mapCartLineStatus(cartItemStatus: string | null, itemStatus: string | null): CartLineStatus {
  if (cartItemStatus === "reserved" && itemStatus === "reserved") return "reserve";
  if (cartItemStatus === "reservation_pending" && (itemStatus === "available" || itemStatus === "listed")) {
    return "en_attente_wallet";
  }
  if (cartItemStatus === "in_cart" && (itemStatus === "available" || itemStatus === "in_cart")) return "disponible";
  return "echec";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

type ResolvedPhotoData = {
  path: string | null;
  position: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
};

function resolveItemPhotoData(photosRaw: unknown): ResolvedPhotoData {
  if (!photosRaw || typeof photosRaw !== "object") return { path: null, position: null };
  const photos = photosRaw as Record<string, unknown>;
  const candidates = [photos.main_url, photos.mainUrl, photos.cover_url, photos.coverUrl, photos.primary_url, photos.primaryUrl, photos.url];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return { path: candidate.trim(), position: null };
    }
  }

  const photoEntries = Object.entries(photos)
    .filter(([key, value]) => key.toLowerCase().startsWith("photo") && value && typeof value === "object")
    .sort(([keyA], [keyB]) => {
      const idxA = Number(keyA.toLowerCase().replace("photo", ""));
      const idxB = Number(keyB.toLowerCase().replace("photo", ""));
      if (Number.isNaN(idxA) || Number.isNaN(idxB)) return keyA.localeCompare(keyB);
      return idxA - idxB;
    });

  for (const [, value] of photoEntries) {
    const row = value as Record<string, unknown>;
    const pathCandidate = row.storage_path ?? row.storagePath ?? row.url ?? row.photo_url ?? row.photoUrl;
    if (typeof pathCandidate === "string" && pathCandidate.trim()) {
      const positionRaw = row.position && typeof row.position === "object" ? (row.position as Record<string, unknown>) : null;
      const offsetRaw = positionRaw?.offset && typeof positionRaw.offset === "object" ? (positionRaw.offset as Record<string, unknown>) : null;
      return {
        path: pathCandidate.trim(),
        position: {
          offset: {
            x: typeof offsetRaw?.x === "number" ? offsetRaw.x : 0,
            y: typeof offsetRaw?.y === "number" ? offsetRaw.y : 0,
          },
          zoom: typeof positionRaw?.zoom === "number" ? positionRaw.zoom : 1,
          aspect: typeof positionRaw?.aspect === "string" ? positionRaw.aspect : "square",
        },
      };
    }
  }

  const entries = photos.entries;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const urlCandidate = row.url ?? row.photo_url ?? row.photoUrl ?? row.storage_path ?? row.storagePath;
      if (typeof urlCandidate === "string" && urlCandidate.trim()) {
        return { path: urlCandidate.trim(), position: null };
      }
    }
  }
  return { path: null, position: null };
}

type ItemRow = {
  id: string;
  title: string | null;
  description: string | null;
  price_points: number | null;
  status: string | null;
  photos?: unknown | null;
  item_brands?: { label?: string | null } | null;
};

type CartFetchSupabase = { from: (t: string) => any } & StorageSignClient;

/** Panier actif / réservé (même logique que les lignes). */
export async function fetchActiveCartSummaryForUser(
  supabase: CartFetchSupabase,
  userId: string,
): Promise<{ cartId: string | null; status: string | null }> {
  const activeCartRes = await supabase
    .from("carts")
    .select("id,status,updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("status", ["active", "reserved"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = activeCartRes.data as { id: string; status: string } | null;
  if (!row?.id) return { cartId: null, status: null };
  return { cartId: row.id, status: row.status };
}

/** Lignes panier actif pour /cart et /cart/payment. */
export async function fetchActiveCartLinesForUser(
  supabase: CartFetchSupabase,
  userId: string,
): Promise<CartLineRowData[]> {
  const activeCartRes = await supabase
    .from("carts")
    .select("id,status,updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("status", ["active", "reserved"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const activeCart = activeCartRes.data as { id: string; status: string } | null;
  if (!activeCart?.id) return [];

  const [cartItemsRes, itemRowsRes] = await Promise.all([
    supabase
      .from("cart_items")
      .select("id,item_id,status,created_at")
      .eq("cart_id", activeCart.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    supabase.from("cart_items").select("item_id").eq("cart_id", activeCart.id).is("deleted_at", null),
  ]);

  const itemIds = (itemRowsRes.data ?? []).map((row: { item_id?: string | null }) => row.item_id).filter(Boolean) as string[];
  let itemsMap = new Map<string, ItemRow>();

  if (itemIds.length > 0) {
    const itemsRes = await supabase
      .from("items")
      .select("id,title,description,price_points,status,photos,item_brands(label)")
      .in("id", itemIds);
    itemsMap = new Map((itemsRes.data ?? []).map((item: ItemRow) => [item.id, item]));
  }

  const signedPhotoByPath = new Map<string, string>();
  const pathsToSign = new Set<string>();
  for (const line of cartItemsRes.data ?? []) {
    const row = line as { item_id: string };
    const item = itemsMap.get(row.item_id);
    const photoData = resolveItemPhotoData(item?.photos ?? null);
    if (photoData.path && !isHttpUrl(photoData.path)) pathsToSign.add(photoData.path);
  }
  await Promise.all(
    [...pathsToSign].map(async (path) => {
      const signed = await createSignedUrlForStoragePath(supabase, path, 60 * 60 * 24);
      if (signed) signedPhotoByPath.set(path, signed);
    }),
  );

  const rows = (cartItemsRes.data ?? []).map((line: { id: string; item_id: string; status: string | null; created_at?: string }) => {
    const item = itemsMap.get(line.item_id);
    const photoData = resolveItemPhotoData(item?.photos ?? null);
    const rawPath = photoData.path;
    const photoUrl =
      rawPath == null ? null : isHttpUrl(rawPath) ? rawPath : (signedPhotoByPath.get(rawPath) ?? null);

    return {
      id: line.id,
      itemId: line.item_id,
      itemName: item?.title?.trim() || "Pièce sans titre",
      brand: item?.item_brands?.label?.trim() || null,
      description: item?.description?.trim() || null,
      pricePoints: Number(item?.price_points ?? 0),
      status: mapCartLineStatus(line.status, item?.status ?? null),
      photoUrl,
      photoPosition: photoData.position,
    };
  });

  return sortCartLinesByPriceAsc(rows);
}
