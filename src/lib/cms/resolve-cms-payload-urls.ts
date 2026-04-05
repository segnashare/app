import type { CmsFramePayload } from "@/lib/cms/cms-types";

/**
 * Ajoute `signed_url` à chaque objet contenant `storage_path` (récursif).
 */
export async function resolveCmsPayloadStorageUrls(
  payload: CmsFramePayload,
  sign: (path: string) => Promise<string | null>,
): Promise<CmsFramePayload> {
  const clone = JSON.parse(JSON.stringify(payload)) as CmsFramePayload & Record<string, unknown>;

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
