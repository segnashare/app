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
      createSignedUrls?: (
        paths: string[],
        expiresIn: number,
      ) => Promise<{
        data?: Array<{ signedUrl?: string; path?: string | null; error?: string | null } | null> | null;
        error?: { message?: string } | null;
      }>;
    };
  };
};

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function cacheKey(bucket: string, path: string) {
  return `${bucket}:${path}`;
}

function readCachedSignedUrl(bucket: string, path: string) {
  const cached = signedUrlCache.get(cacheKey(bucket, path));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    signedUrlCache.delete(cacheKey(bucket, path));
    return null;
  }
  return cached.url;
}

function writeCachedSignedUrl(bucket: string, path: string, url: string, expiresIn: number) {
  const safetyWindowMs = Math.min(60_000, Math.max(0, expiresIn * 100));
  signedUrlCache.set(cacheKey(bucket, path), {
    url,
    expiresAt: Date.now() + expiresIn * 1000 - safetyWindowMs,
  });
}

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
    const cached = readCachedSignedUrl(buckets[0], objectPath);
    if (cached) return cached;
    const { data, error } = await supabase.storage.from(buckets[0]).createSignedUrl(objectPath, expiresIn);
    if (!error && data?.signedUrl) {
      writeCachedSignedUrl(buckets[0], objectPath, data.signedUrl, expiresIn);
      return data.signedUrl;
    }
    return null;
  }
  const results = await Promise.all(
    buckets.map((bucketId) => supabase.storage.from(bucketId).createSignedUrl(objectPath, expiresIn)),
  );
  for (let i = 0; i < buckets.length; i++) {
    const { data, error } = results[i];
    if (!error && data?.signedUrl) {
      writeCachedSignedUrl(buckets[i], objectPath, data.signedUrl, expiresIn);
      return data.signedUrl;
    }
  }
  return null;
}

export async function createSignedUrlsForStoragePaths(
  supabase: StorageSignClient,
  rawPaths: string[],
  expiresIn: number,
  options?: { explicitBucket?: string | null },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const explicit = normalizeExplicitBucket(options?.explicitBucket ?? null);
  const grouped = new Map<string, Array<{ raw: string; objectPath: string }>>();
  const fallbackRawPaths: string[] = [];

  for (const raw of [...new Set(rawPaths.map((p) => p.trim()).filter(Boolean))]) {
    if (/^https?:\/\//i.test(raw)) {
      out.set(raw, raw);
      continue;
    }

    const objectPath = normalizeStorageObjectPath(raw);
    if (!objectPath) continue;
    const buckets = explicit ? ([explicit] as const) : orderedBucketsForStoragePath(objectPath);

    if (buckets.length !== 1) {
      fallbackRawPaths.push(raw);
      continue;
    }

    const cached = readCachedSignedUrl(buckets[0], objectPath);
    if (cached) {
      out.set(raw, cached);
      continue;
    }

    const rows = grouped.get(buckets[0]) ?? [];
    rows.push({ raw, objectPath });
    grouped.set(buckets[0], rows);
  }

  await Promise.all(
    [...grouped.entries()].map(async ([bucketId, rows]) => {
      const bucket = supabase.storage.from(bucketId);
      const createSignedUrls = bucket.createSignedUrls;
      if (!createSignedUrls) {
        fallbackRawPaths.push(...rows.map((row) => row.raw));
        return;
      }

      const paths = rows.map((row) => row.objectPath);
      const { data, error } = await createSignedUrls.call(bucket, paths, expiresIn);
      if (error || !Array.isArray(data)) {
        fallbackRawPaths.push(...rows.map((row) => row.raw));
        return;
      }

      data.forEach((entry, index) => {
        const row = rows[index];
        const signedUrl = entry?.signedUrl;
        if (!signedUrl) return;
        writeCachedSignedUrl(bucketId, row.objectPath, signedUrl, expiresIn);
        out.set(row.raw, signedUrl);
      });
    }),
  );

  await Promise.all(
    fallbackRawPaths.map(async (raw) => {
      const signed = await createSignedUrlForStoragePath(supabase, raw, expiresIn, options);
      if (signed) out.set(raw, signed);
    }),
  );

  return out;
}
