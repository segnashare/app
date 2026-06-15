import type { CmsFramePayload, CmsFrameRow } from "@/lib/cms/cms-types";
import { collectCmsStoragePaths } from "@/lib/cms/cms-storage-paths";
import { CMS_SIGNED_URL_TTL_SECONDS, cmsStorageSignClient } from "@/lib/cms/cms-sign-client";
import { createSignedUrlsForStoragePaths, type StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

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

/**
 * Signe les visuels d’un lot de frames en un seul appel Storage, puis applique les URLs.
 */
export async function resolveCmsFrameRowsStorageUrls(
  rows: CmsFrameRow[],
  signClient?: StorageSignClient,
  signTtlSeconds = CMS_SIGNED_URL_TTL_SECONDS,
): Promise<CmsFrameRow[]> {
  const [resolved] = await resolveCmsFrameRowGroupsStorageUrlsBatch([rows], signClient, signTtlSeconds);
  return resolved ?? [];
}

/** Signe les visuels de plusieurs lots de frames CMS en un seul appel Storage. */
export async function resolveCmsFrameRowGroupsStorageUrlsBatch(
  frameGroups: CmsFrameRow[][],
  signClient?: StorageSignClient,
  signTtlSeconds = CMS_SIGNED_URL_TTL_SECONDS,
): Promise<CmsFrameRow[][]> {
  const allRows = frameGroups.flat();
  if (allRows.length === 0) return frameGroups.map(() => []);
  const client = cmsStorageSignClient(signClient);
  const paths = [...collectCmsStoragePaths(allRows.map((row) => row.payload))];
  const signedByPath = await createSignedUrlsForStoragePaths(client, paths, signTtlSeconds);
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
