import { parsePhotoEntriesFromItemPhotos, getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import {
  createSignedUrlForStoragePath,
  createSignedUrlsForStoragePaths,
} from "@/lib/supabase/storage-resolve-signed-url";

export type MemberCatalogItemPreview = {
  id: string;
  title: string;
  brandLabel: string | null;
  photoUrls: string[];
  pricePoints: number | null;
};

const CATALOG_STATUSES = ["available", "in_cart", "reserved"] as const;
const MAX_PREVIEW_PHOTOS = 3;

function firstRelation<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function photoPathFromEntry(entry: Record<string, unknown>): string | null {
  const raw = entry.storage_path ?? entry.storagePath ?? entry.url ?? entry.photo_url ?? entry.photoUrl;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function getFirstThreePhotoPaths(rawPhotos: unknown): string[] {
  const entries = parsePhotoEntriesFromItemPhotos(rawPhotos);
  const paths: string[] = [];
  for (const entry of entries) {
    const path = photoPathFromEntry(entry);
    if (path) paths.push(path);
    if (paths.length >= MAX_PREVIEW_PHOTOS) break;
  }
  if (paths.length === 0) {
    const single = getFirstPhotoStoragePath(rawPhotos);
    if (single) paths.push(single);
  }
  return paths.slice(0, MAX_PREVIEW_PHOTOS);
}

async function resolvePhotoUrls(supabase: unknown, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const httpPaths = paths.filter((p) => /^https?:\/\//i.test(p));
  const storagePaths = paths.filter((p) => !/^https?:\/\//i.test(p));
  const signedByPath = await createSignedUrlsForStoragePaths(
    supabase as Parameters<typeof createSignedUrlsForStoragePaths>[0],
    storagePaths,
    60 * 60 * 24,
  );
  const out: string[] = [];
  for (const path of paths) {
    if (/^https?:\/\//i.test(path)) {
      out.push(path);
      continue;
    }
    const url = signedByPath.get(path) ?? (await createSignedUrlForStoragePath(
      supabase as Parameters<typeof createSignedUrlForStoragePath>[0],
      path,
      60 * 60 * 24,
    ));
    if (url) out.push(url);
  }
  return out;
}

function resolveBrandLabel(row: {
  title?: string | null;
  item_custom_brand_label?: string | null;
  item_brands?: { label?: string | null; slug?: string | null } | Array<{ label?: string | null; slug?: string | null }> | null;
}): string | null {
  const custom = row.item_custom_brand_label?.trim() || null;
  const brand = firstRelation(row.item_brands);
  const otherFallback = brand?.slug === "autre" ? row.title?.trim().slice(0, 30) ?? null : null;
  return custom || otherFallback || brand?.label?.trim() || null;
}

/** Pièces catalogue visibles d’un membre (profil public / propre profil). */
export async function fetchMemberCatalogItemsForProfile(
  supabase: unknown,
  ownerUserId: string,
  limit = 24,
): Promise<MemberCatalogItemPreview[]> {
  const sb = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          is: (col: string, val: null) => {
            in: (col: string, vals: readonly string[]) => {
              order: (col: string, opts: { ascending: boolean }) => {
                limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
              };
            };
          };
        };
      };
    };
  };

  const { data, error } = await sb
    .from("items")
    .select(
      "id, title, photos, price_points, item_custom_brand_label, item_brands(label, slug)",
    )
    .eq("owner_user_id", ownerUserId)
    .is("deleted_at", null)
    .in("status", [...CATALOG_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data)) return [];

  const out: MemberCatalogItemPreview[] = [];
  for (const raw of data) {
    const row = raw as {
      id?: string;
      title?: string | null;
      photos?: unknown;
      price_points?: number | string | null;
      item_custom_brand_label?: string | null;
      item_brands?: { label?: string | null; slug?: string | null } | Array<{ label?: string | null; slug?: string | null }> | null;
    };
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Pièce";
    const ptsRaw = row.price_points;
    const pricePoints =
      ptsRaw != null && Number.isFinite(Number(ptsRaw)) ? Math.round(Number(ptsRaw)) : null;
    const photoUrls = await resolvePhotoUrls(supabase, getFirstThreePhotoPaths(row.photos));
    out.push({
      id,
      title,
      brandLabel: resolveBrandLabel(row),
      photoUrls,
      pricePoints,
    });
  }
  return out;
}
