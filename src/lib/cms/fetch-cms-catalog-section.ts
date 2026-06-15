import type {
  CmsCatalogSectionConfig,
  CmsFramePayload,
  CmsFrameRow,
  CmsFrameType,
  CmsPlanCode,
} from "@/lib/cms/cms-types";
import { isSupabaseTransportFailure, warnCmsSupabaseUnreachable } from "@/lib/cms/cms-supabase-transport";
import { fetchCmsCatalogSectionRawCached } from "@/lib/cms/cms-data-cache";
import { CMS_SIGNED_URL_TTL_SECONDS, cmsStorageSignClient } from "@/lib/cms/cms-sign-client";
import { resolveCmsFrameRowsStorageUrls } from "@/lib/cms/resolve-cms-payload-urls";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

const FRAME_TYPES: CmsFrameType[] = [
  "offer_card",
  "category_capsule",
  "promo_ad",
  "editorial_card",
  "shop_item_ref",
  "shop_category_ref",
  "shop_brand_ref",
  "shop_link_card",
  "profile_plus_hero",
];
const PLAN_CODES: CmsPlanCode[] = ["guest", "segna_plus", "segna_x"];

type RpcFrame = {
  id?: unknown;
  frame_type?: unknown;
  sort_order?: unknown;
  plan_code?: unknown;
  payload?: unknown;
};

function coerceFrameId(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (v != null && String(v).length > 0 && String(v) !== "[object Object]") return String(v);
  return null;
}

function isFrameType(v: unknown): v is CmsFrameType {
  return typeof v === "string" && (FRAME_TYPES as string[]).includes(v);
}

function isPlanCode(v: unknown): v is CmsPlanCode {
  return typeof v === "string" && (PLAN_CODES as string[]).includes(v);
}

function parseCatalogConfig(raw: unknown): CmsCatalogSectionConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: CmsCatalogSectionConfig = {};
  if (typeof o.title === "string") out.title = o.title;
  if (o.hide_section_title === true) out.hide_section_title = true;
  if (typeof o.show_more_arrow === "boolean") out.show_more_arrow = o.show_more_arrow;
  if (typeof o.more_href === "string") out.more_href = o.more_href;
  const vpc = o.visible_plan_codes;
  if (Array.isArray(vpc)) {
    const xs = vpc.filter((x): x is CmsPlanCode => typeof x === "string" && (PLAN_CODES as string[]).includes(x));
    if (xs.length > 0) out.visible_plan_codes = xs;
  }
  return out;
}

function parseFrameRows(data: unknown): CmsFrameRow[] {
  if (!Array.isArray(data)) return [];
  const out: CmsFrameRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as RpcFrame;
    const id = coerceFrameId(r.id);
    if (!id) continue;
    if (!isFrameType(r.frame_type)) continue;
    if (!isPlanCode(r.plan_code)) continue;
    const sort = typeof r.sort_order === "number" ? r.sort_order : Number(r.sort_order);
    const payloadRaw = r.payload;
    const payload =
      payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw)
        ? (payloadRaw as CmsFramePayload)
        : {};
    out.push({
      id,
      frame_type: r.frame_type,
      sort_order: Number.isFinite(sort) ? sort : 0,
      plan_code: r.plan_code,
      payload,
    });
  }
  return out;
}

export type CmsCatalogSectionBundle = {
  config: CmsCatalogSectionConfig;
  frames: CmsFrameRow[];
};

export type CmsCatalogSectionRawBundle = {
  config: CmsCatalogSectionConfig;
  frames: CmsFrameRow[];
};

function parseCatalogSectionRaw(data: unknown): CmsCatalogSectionRawBundle {
  const root = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    config: parseCatalogConfig(root.config),
    frames: parseFrameRows(root.frames),
  };
}

/** Lecture RPC directe (sans cache) — repli si le cache admin est indisponible. */
async function fetchCmsCatalogSectionRawDirect(
  supabase: StorageSignClient,
  sectionKey: string,
): Promise<CmsCatalogSectionRawBundle> {
  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const { data, error } = await rpc.rpc("get_cms_catalog_section", { p_section_key: sectionKey });
  if (error) throw new Error(error.message ?? "get_cms_catalog_section failed");
  return parseCatalogSectionRaw(data);
}

export async function fetchCmsCatalogSectionRaw(
  supabase: StorageSignClient,
  sectionKey: string,
): Promise<CmsCatalogSectionRawBundle> {
  try {
    const cached = await fetchCmsCatalogSectionRawCached(sectionKey);
    if (cached != null) return parseCatalogSectionRaw(cached);
  } catch {
    /* repli session ci-dessous */
  }
  return fetchCmsCatalogSectionRawDirect(supabase, sectionKey);
}

export async function resolveCmsCatalogSectionBundle(
  raw: CmsCatalogSectionRawBundle,
  signClient?: StorageSignClient,
  signTtlSeconds = CMS_SIGNED_URL_TTL_SECONDS,
): Promise<CmsCatalogSectionBundle> {
  const frames = await resolveCmsFrameRowsStorageUrls(raw.frames, signClient, signTtlSeconds);
  return { config: raw.config, frames };
}

/**
 * Charge config publiée + frames pour une section hub catalogue (RPC dédiée).
 */
export async function fetchCmsCatalogSectionResolved(
  supabase: StorageSignClient,
  sectionKey: string,
  signTtlSeconds = CMS_SIGNED_URL_TTL_SECONDS,
): Promise<CmsCatalogSectionBundle> {
  try {
    const raw = await fetchCmsCatalogSectionRaw(supabase, sectionKey);
    const rawLen = raw.frames.length;
    if (process.env.SEGNA_DEBUG_CMS === "1") {
      const payload = (p: CmsFramePayload) => ({
        title: typeof p.title === "string" ? p.title : "",
        target_url: typeof p.target_url === "string" ? p.target_url : "",
      });
      console.info(
        `[SEGNA_DEBUG_CMS] get_cms_catalog_section("${sectionKey}") frames parsées: ${rawLen}`,
      );
      console.info(
        "[SEGNA_DEBUG_CMS] frames parsées:",
        raw.frames.map((r) => ({ id: r.id, type: r.frame_type, ...payload(r.payload) })),
      );
    }
    return resolveCmsCatalogSectionBundle(raw, cmsStorageSignClient(supabase), signTtlSeconds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rpcMissing =
      msg.includes("Could not find the function") ||
      msg.includes("schema cache") ||
      /PGRST202|42883/i.test(msg);
    if (rpcMissing) {
      if (process.env.NODE_ENV === "development") {
        console.info(
          `[CMS] RPC get_cms_catalog_section absente — appliquer la migration 20260502160000_cms_shop_hub_catalog.sql (section: ${sectionKey}).`,
        );
      }
    } else if (isSupabaseTransportFailure(msg)) {
      warnCmsSupabaseUnreachable(`get_cms_catalog_section "${sectionKey}"`, msg);
    } else {
      console.error("get_cms_catalog_section", sectionKey, msg);
    }
    return { config: {}, frames: [] };
  }
}
