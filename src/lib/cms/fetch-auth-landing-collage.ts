import type { CmsImageRef } from "@/lib/cms/cms-types";
import { isSupabaseTransportFailure, warnCmsSupabaseUnreachable } from "@/lib/cms/cms-supabase-transport";
import { createSignedUrlForStoragePath, type StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

export type AuthCollageAspect = "square" | "portrait" | "landscape";
export type AuthCollageSize = "small" | "medium" | "large";

export type AuthCollageSlotPayload = {
  collage_image?: CmsImageRef | null;
  collage_aspect?: string;
  collage_size?: string;
  collage_top_pct?: number;
  collage_left_pct?: number;
  collage_float_delay_ms?: number;
};

export type AuthCollageFrameRow = {
  id: string;
  frame_type: string;
  sort_order: number;
  plan_code: string;
  payload: AuthCollageSlotPayload;
};

type RpcRow = {
  id?: unknown;
  frame_type?: unknown;
  sort_order?: unknown;
  plan_code?: unknown;
  payload?: unknown;
};

function parseRows(data: unknown): AuthCollageFrameRow[] {
  if (!Array.isArray(data)) return [];
  const out: AuthCollageFrameRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as RpcRow;
    const id = typeof r.id === "string" ? r.id : null;
    if (!id) continue;
    const sort = typeof r.sort_order === "number" ? r.sort_order : Number(r.sort_order);
    const payloadRaw = r.payload;
    const payload =
      payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw)
        ? (payloadRaw as AuthCollageSlotPayload)
        : {};
    out.push({
      id,
      frame_type: typeof r.frame_type === "string" ? r.frame_type : "auth_collage_image",
      sort_order: Number.isFinite(sort) ? sort : 0,
      plan_code: typeof r.plan_code === "string" ? r.plan_code : "guest",
      payload,
    });
  }
  return out;
}

/**
 * Signatures Storage en une seule vague : chemins dédupliqués + `Promise.all` (évite 8× clone JSON récursif).
 */
async function resolveAuthCollageRowsSignedUrls(
  rows: AuthCollageFrameRow[],
  supabase: StorageSignClient,
  signTtlSeconds: number,
): Promise<AuthCollageFrameRow[]> {
  const sign = (path: string) => createSignedUrlForStoragePath(supabase, path, signTtlSeconds);
  const rawPaths = rows
    .map((r) => r.payload.collage_image?.storage_path)
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());
  const uniquePaths = [...new Set(rawPaths)];
  const signedList = await Promise.all(uniquePaths.map((path) => sign(path)));
  const urlByPath = new Map<string, string | null>();
  uniquePaths.forEach((path, i) => {
    urlByPath.set(path, signedList[i]);
  });

  return rows.map((row) => {
    const img = row.payload.collage_image;
    const path = typeof img?.storage_path === "string" ? img.storage_path.trim() : "";
    if (!img || !path) {
      return { ...row, payload: { ...row.payload } };
    }
    const signedUrl = urlByPath.get(path) ?? undefined;
    const nextImage: CmsImageRef = { ...img, signed_url: signedUrl ?? undefined };
    return {
      ...row,
      payload: {
        ...row.payload,
        collage_image: nextImage,
      },
    };
  });
}

/**
 * Collage d’accueil /auth : RPC publique + URLs Storage signées (anon ou session).
 */
export async function fetchAuthLandingCollageResolved(
  supabase: StorageSignClient,
  signTtlSeconds = 3600,
): Promise<AuthCollageFrameRow[]> {
  const rpc = supabase as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const t0 = Date.now();
  try {
    const { data, error } = await rpc.rpc("get_cms_auth_landing_frames");
    if (error) {
      const msg = error.message ?? "";
      const rpcMissing =
        msg.includes("Could not find the function") ||
        msg.includes("schema cache") ||
        /PGRST202|42883/i.test(msg);
      if (rpcMissing) {
        if (process.env.NODE_ENV === "development") {
          console.info("[CMS] RPC get_cms_auth_landing_frames absente — appliquer la migration cms auth landing.");
        }
      } else if (isSupabaseTransportFailure(msg)) {
        warnCmsSupabaseUnreachable("get_cms_auth_landing_frames", msg);
      } else {
        console.error("get_cms_auth_landing_frames", msg);
      }
      return [];
    }

    const rows = parseRows(data);
    const rpcMs = Date.now() - t0;
    const tResolve0 = Date.now();
    const resolved = await resolveAuthCollageRowsSignedUrls(rows, supabase, signTtlSeconds);
    if (process.env.NODE_ENV === "development") {
      const withUrl = resolved.filter((r) => Boolean(r.payload.collage_image?.signed_url)).length;
      const uniqueSignCount = new Set(
        rows
          .map((r) => r.payload.collage_image?.storage_path)
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .map((p) => p.trim()),
      ).size;
      console.info("[auth-collage] fetchAuthLandingCollageResolved", {
        totalMs: Date.now() - t0,
        rpcMs,
        signParallelMs: Date.now() - tResolve0,
        frameCount: resolved.length,
        uniqueStoragePaths: uniqueSignCount,
        withSignedUrl: withUrl,
      });
    }
    return resolved;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnCmsSupabaseUnreachable("get_cms_auth_landing_frames", msg);
    return [];
  }
}
