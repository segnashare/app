const BUCKET_ITEMS = "bucket_items";
const BUCKET_FOCUS = "bucket_focus";
const BUCKET_CMS_APP = "bucket_cms_app";
const BUCKET_COMMUNITY = "bucket_community";

/** Lots trop gros → réponses Storage parfois tronquées. */
const SIGN_PATH_CHUNK = 40;

/** Chemins d’upload : `ModifyPageClient` / `items/new` (items → bucket_items, looks & profil → bucket_focus). */

export function normalizeStorageObjectPath(raw: string): string {
  let p = raw.trim().replace(/^\/+/, "");
  const lower = p.toLowerCase();
  if (lower.startsWith(`${BUCKET_ITEMS}/`)) p = p.slice(BUCKET_ITEMS.length + 1);
  else if (lower.startsWith(`${BUCKET_FOCUS}/`)) p = p.slice(BUCKET_FOCUS.length + 1);
  else if (lower.startsWith(`${BUCKET_CMS_APP}/`)) p = p.slice(BUCKET_CMS_APP.length + 1);
  else if (lower.startsWith(`${BUCKET_COMMUNITY}/`)) p = p.slice(BUCKET_COMMUNITY.length + 1);
  return p;
}

/**
 * Buckets à essayer **dans l’ordre** de préférence (premier `createSignedUrl` qui réussit gagne).
 */
export function orderedBucketsForStoragePath(normalizedPath: string): readonly string[] {
  const pl = normalizedPath.toLowerCase();
  // Uploads BO : `cms-app/<id>/<file>` (pas de segment avant « cms-app »).
  if (pl.startsWith("cms-app/") || pl.includes("/cms-app/")) return [BUCKET_CMS_APP];
  if (pl.includes("/inspirations/")) return [BUCKET_COMMUNITY];
  if (pl.includes("/items/")) return [BUCKET_ITEMS];
  if (pl.includes("/looks/") || pl.includes("/profile/")) return [BUCKET_FOCUS];
  return [BUCKET_ITEMS, BUCKET_FOCUS];
}

function normalizeExplicitBucket(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (t === BUCKET_ITEMS || t === BUCKET_FOCUS || t === BUCKET_CMS_APP || t === BUCKET_COMMUNITY) return t;
  return null;
}

export type StorageImageTransform = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain" | "fill";
};

/** CMS / hero display size — avoids shipping multi‑MB camera originals. */
export const CMS_DISPLAY_IMAGE_TRANSFORM: StorageImageTransform = {
  width: 1200,
  quality: 65,
  resize: "contain",
};

export function isLikelyVideoStoragePath(path: string): boolean {
  return /\.(mp4|mov|webm|m4v)(?:$|\?)/i.test(path.trim());
}

export type StorageSignClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
        options?: { transform?: StorageImageTransform },
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
/** Dedup concurrent signs for the same object. */
const inflightSigns = new Map<string, Promise<string | null>>();

function storageClientCacheScope(supabase: StorageSignClient) {
  const client = supabase as StorageSignClient & { supabaseUrl?: string; storageUrl?: string };
  const scope = client.supabaseUrl?.trim() || client.storageUrl?.trim() || "default";
  return scope.replace(/\/+$/, "");
}

function transformCacheSuffix(transform?: StorageImageTransform | null): string {
  if (!transform) return "";
  return `:t:${transform.width ?? ""}x${transform.height ?? ""}:q${transform.quality ?? ""}:${transform.resize ?? ""}`;
}

function cacheKey(
  supabase: StorageSignClient,
  bucket: string,
  path: string,
  transform?: StorageImageTransform | null,
) {
  return `${storageClientCacheScope(supabase)}:${bucket}:${path}${transformCacheSuffix(transform)}`;
}

function readCachedSignedUrl(
  supabase: StorageSignClient,
  bucket: string,
  path: string,
  transform?: StorageImageTransform | null,
) {
  const key = cacheKey(supabase, bucket, path, transform);
  const cached = signedUrlCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    signedUrlCache.delete(key);
    return null;
  }
  return cached.url;
}

function writeCachedSignedUrl(
  supabase: StorageSignClient,
  bucket: string,
  path: string,
  url: string,
  expiresIn: number,
  transform?: StorageImageTransform | null,
) {
  const safetyWindowMs = Math.min(60_000, Math.max(0, expiresIn * 100));
  signedUrlCache.set(cacheKey(supabase, bucket, path, transform), {
    url,
    expiresAt: Date.now() + expiresIn * 1000 - safetyWindowMs,
  });
}

async function signObjectInBucket(
  supabase: StorageSignClient,
  bucketId: string,
  objectPath: string,
  expiresIn: number,
  transform?: StorageImageTransform | null,
): Promise<string | null> {
  const cached = readCachedSignedUrl(supabase, bucketId, objectPath, transform);
  if (cached) return cached;

  const key = cacheKey(supabase, bucketId, objectPath, transform);
  const inflight = inflightSigns.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const { data, error } = await supabase.storage
      .from(bucketId)
      .createSignedUrl(objectPath, expiresIn, transform ? { transform } : undefined);
    if (!error && data?.signedUrl) {
      writeCachedSignedUrl(supabase, bucketId, objectPath, data.signedUrl, expiresIn, transform);
      return data.signedUrl;
    }
    if (transform) {
      return signObjectInBucket(supabase, bucketId, objectPath, expiresIn, null);
    }
    return null;
  })().finally(() => {
    inflightSigns.delete(key);
  });

  inflightSigns.set(key, promise);
  return promise;
}

/**
 * Résout une URL signée pour un chemin stocké en base (ou renvoie l’URL http(s) telle quelle).
 */
export async function createSignedUrlForStoragePath(
  supabase: StorageSignClient,
  rawPath: string,
  expiresIn: number,
  options?: { explicitBucket?: string | null; transform?: StorageImageTransform | null },
): Promise<string | null> {
  const trimmed = rawPath.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const objectPath = normalizeStorageObjectPath(rawPath);
  if (!objectPath) return null;
  const explicit = normalizeExplicitBucket(options?.explicitBucket ?? null);
  const buckets = explicit ? ([explicit] as const) : orderedBucketsForStoragePath(objectPath);
  const transform = options?.transform ?? null;
  if (buckets.length === 1) {
    return signObjectInBucket(supabase, buckets[0], objectPath, expiresIn, transform);
  }
  for (const bucketId of buckets) {
    const cached = readCachedSignedUrl(supabase, bucketId, objectPath, transform);
    if (cached) return cached;
  }
  const results = await Promise.all(
    buckets.map((bucketId) => signObjectInBucket(supabase, bucketId, objectPath, expiresIn, transform)),
  );
  for (const signed of results) {
    if (signed) return signed;
  }
  return null;
}

export async function createSignedUrlsForStoragePaths(
  supabase: StorageSignClient,
  rawPaths: string[],
  expiresIn: number,
  options?: { explicitBucket?: string | null; transform?: StorageImageTransform | null },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const transform = options?.transform ?? null;

  if (transform) {
    await Promise.all(
      [...new Set(rawPaths.map((p) => p.trim()).filter(Boolean))].map(async (raw) => {
        const signed = await createSignedUrlForStoragePath(supabase, raw, expiresIn, options);
        if (signed) out.set(raw, signed);
      }),
    );
    return out;
  }

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

    const cached = readCachedSignedUrl(supabase, buckets[0], objectPath, null);
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

      for (let i = 0; i < rows.length; i += SIGN_PATH_CHUNK) {
        const chunk = rows.slice(i, i + SIGN_PATH_CHUNK);
        const paths = chunk.map((row) => row.objectPath);
        const { data, error } = await createSignedUrls.call(bucket, paths, expiresIn);
        if (error || !Array.isArray(data)) {
          fallbackRawPaths.push(...chunk.map((row) => row.raw));
          continue;
        }

        data.forEach((entry, index) => {
          const row = chunk[index];
          const signedUrl = entry?.signedUrl;
          if (!signedUrl) {
            fallbackRawPaths.push(row.raw);
            return;
          }
          writeCachedSignedUrl(supabase, bucketId, row.objectPath, signedUrl, expiresIn);
          out.set(row.raw, signedUrl);
        });
      }
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
