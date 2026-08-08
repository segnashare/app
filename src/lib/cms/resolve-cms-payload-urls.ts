import type { CmsFramePayload, CmsFrameRow } from "@/lib/cms/cms-types";
import { collectCmsStoragePaths } from "@/lib/cms/cms-storage-paths";
import { CMS_SIGNED_URL_TTL_SECONDS, cmsStorageSignClient } from "@/lib/cms/cms-sign-client";
import {
  CMS_DISPLAY_IMAGE_TRANSFORM,
  createSignedUrlsForStoragePaths,
  isLikelyVideoStoragePath,
  type StorageImageTransform,
  type StorageSignClient,
} from "@/lib/supabase/storage-resolve-signed-url";

function clonePayload(payload: CmsFramePayload): CmsFramePayload & Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as CmsFramePayload & Record<string, unknown>;
}

function applySignedUrlsWalk(o: unknown, signedByPath: Map<string, string>): void {
  if (o === null || o === undefined) return;
  if (Array.isArray(o)) {
    o.forEach((x) => applySignedUrlsWalk(x, signedByPath));
    return;
  }
  if (typeof o !== "object") return;

  const rec = o as Record<string, unknown>;
  if (typeof rec.storage_path === "string" && rec.storage_path.trim()) {
    const url = signedByPath.get(rec.storage_path.trim());
    if (url) rec.signed_url = url;
  }
  Object.values(rec).forEach((v) => applySignedUrlsWalk(v, signedByPath));
}

/** Applique des URLs déjà signées (batch) — sans appel Storage supplémentaire. */
export function applySignedUrlsToCmsPayload(
  payload: CmsFramePayload,
  signedByPath: Map<string, string>,
): CmsFramePayload {
  const clone = clonePayload(payload);
  applySignedUrlsWalk(clone, signedByPath);
  return clone;
}

async function signCmsPaths(
  client: StorageSignClient,
  paths: string[],
  signTtlSeconds: number,
  imageTransform: StorageImageTransform | null,
): Promise<Map<string, string>> {
  const signedByPath = new Map<string, string>();
  if (!paths.length) return signedByPath;

  const imagePaths = imageTransform ? paths.filter((p) => !isLikelyVideoStoragePath(p)) : [];
  const plainPaths = imageTransform ? paths.filter((p) => isLikelyVideoStoragePath(p)) : paths;

  const [images, plain] = await Promise.all([
    imagePaths.length
      ? createSignedUrlsForStoragePaths(client, imagePaths, signTtlSeconds, {
          transform: imageTransform,
        })
      : Promise.resolve(new Map<string, string>()),
    plainPaths.length
      ? createSignedUrlsForStoragePaths(client, plainPaths, signTtlSeconds)
      : Promise.resolve(new Map<string, string>()),
  ]);
  images.forEach((url, path) => signedByPath.set(path, url));
  plain.forEach((url, path) => signedByPath.set(path, url));
  return signedByPath;
}

/**
 * Signe les visuels d’un lot de frames en un seul appel Storage, puis applique les URLs.
 * Les images CMS passent par Image Transformation (~100–200KB) ; les vidéos restent en original.
 */
export async function resolveCmsFrameRowsStorageUrls(
  rows: CmsFrameRow[],
  signClient?: StorageSignClient,
  signTtlSeconds = CMS_SIGNED_URL_TTL_SECONDS,
  options?: { imageTransform?: StorageImageTransform | null },
): Promise<CmsFrameRow[]> {
  const [resolved] = await resolveCmsFrameRowGroupsStorageUrlsBatch(
    [rows],
    signClient,
    signTtlSeconds,
    options,
  );
  return resolved ?? [];
}

/** Signe les visuels de plusieurs lots de frames CMS en un seul appel Storage. */
export async function resolveCmsFrameRowGroupsStorageUrlsBatch(
  frameGroups: CmsFrameRow[][],
  signClient?: StorageSignClient,
  signTtlSeconds = CMS_SIGNED_URL_TTL_SECONDS,
  options?: { imageTransform?: StorageImageTransform | null },
): Promise<CmsFrameRow[][]> {
  const allRows = frameGroups.flat();
  if (allRows.length === 0) return frameGroups.map(() => []);
  const client = cmsStorageSignClient(signClient);
  const paths = [...collectCmsStoragePaths(allRows.map((row) => row.payload))];
  const imageTransform =
    options?.imageTransform === undefined ? CMS_DISPLAY_IMAGE_TRANSFORM : options.imageTransform;
  const signedByPath = await signCmsPaths(client, paths, signTtlSeconds, imageTransform);
  return frameGroups.map((rows) =>
    rows.map((row) => ({
      ...row,
      payload: applySignedUrlsToCmsPayload(row.payload, signedByPath),
    })),
  );
}

/**
 * Ajoute `signed_url` à chaque objet contenant `storage_path` (récursif).
 */
export async function resolveCmsPayloadStorageUrls(
  payload: CmsFramePayload,
  sign: (path: string) => Promise<string | null>,
): Promise<CmsFramePayload> {
  const clone = clonePayload(payload);

  async function walk(o: unknown): Promise<void> {
    if (o === null || o === undefined) return;
    if (Array.isArray(o)) {
      await Promise.all(o.map((x) => walk(x)));
      return;
    }
    if (typeof o !== "object") return;

    const rec = o as Record<string, unknown>;
    if (typeof rec.storage_path === "string" && rec.storage_path.trim()) {
      const url = await sign(rec.storage_path.trim());
      if (url) {
        rec.signed_url = url;
      }
    }
    await Promise.all(Object.values(rec).map((v) => walk(v)));
  }

  await walk(clone);
  return clone;
}
