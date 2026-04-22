const BUCKET_ITEMS = "bucket_items";
const BUCKET_FOCUS = "bucket_focus";
const BUCKET_CMS_APP = "bucket_cms_app";

/** Chemins d’upload : `ModifyPageClient` / `items/new` (items → bucket_items, looks & profil → bucket_focus). */

export function normalizeStorageObjectPath(raw: string): string {
  let p = raw.trim().replace(/^\/+/, "");
  const lower = p.toLowerCase();
  if (lower.startsWith(`${BUCKET_ITEMS}/`)) p = p.slice(BUCKET_ITEMS.length + 1);
  else if (lower.startsWith(`${BUCKET_FOCUS}/`)) p = p.slice(BUCKET_FOCUS.length + 1);
  else if (lower.startsWith(`${BUCKET_CMS_APP}/`)) p = p.slice(BUCKET_CMS_APP.length + 1);
  return p;
}

/**
 * Buckets à essayer **dans l’ordre** de préférence (premier `createSignedUrl` qui réussit gagne).
 */
export function orderedBucketsForStoragePath(normalizedPath: string): readonly string[] {
  const pl = normalizedPath.toLowerCase();
  // Uploads BO : `cms-app/<id>/<file>` (pas de segment avant « cms-app »).
  if (pl.startsWith("cms-app/") || pl.includes("/cms-app/")) return [BUCKET_CMS_APP];
  if (pl.includes("/items/")) return [BUCKET_ITEMS];
  if (pl.includes("/looks/") || pl.includes("/profile/")) return [BUCKET_FOCUS];
  return [BUCKET_ITEMS, BUCKET_FOCUS];
}

function normalizeExplicitBucket(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (t === BUCKET_ITEMS || t === BUCKET_FOCUS || t === BUCKET_CMS_APP) return t;
  return null;
}

export type StorageSignClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data?: { signedUrl?: string } | null; error?: { message?: string } | null }>;
    };
  };
};

/**
 * Résout une URL signée pour un chemin stocké en base (ou renvoie l’URL http(s) telle quelle).
 */
export async function createSignedUrlForStoragePath(
  supabase: StorageSignClient,
  rawPath: string,
  expiresIn: number,
  options?: { explicitBucket?: string | null },
): Promise<string | null> {
  const trimmed = rawPath.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const objectPath = normalizeStorageObjectPath(rawPath);
  if (!objectPath) return null;
  const explicit = normalizeExplicitBucket(options?.explicitBucket ?? null);
  const buckets = explicit ? ([explicit] as const) : orderedBucketsForStoragePath(objectPath);
  if (buckets.length === 1) {
    const { data, error } = await supabase.storage.from(buckets[0]).createSignedUrl(objectPath, expiresIn);
    if (!error && data?.signedUrl) return data.signedUrl;
    return null;
  }
  const results = await Promise.all(
    buckets.map((bucketId) => supabase.storage.from(bucketId).createSignedUrl(objectPath, expiresIn)),
  );
  for (let i = 0; i < buckets.length; i++) {
    const { data, error } = results[i];
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return null;
}
