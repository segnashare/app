import type { CmsFramePayload, CmsFrameRow, CmsFrameType, CmsPlanCode } from "@/lib/cms/cms-types";
import { isSupabaseTransportFailure, warnCmsSupabaseUnreachable } from "@/lib/cms/cms-supabase-transport";
import { fetchCmsSectionFramesRawCached } from "@/lib/cms/cms-data-cache";
import { CMS_SIGNED_URL_TTL_SECONDS, cmsStorageSignClient } from "@/lib/cms/cms-sign-client";
import { resolveCmsFrameRowsStorageUrls } from "@/lib/cms/resolve-cms-payload-urls";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

type RpcFrame = {
  id?: unknown;
  frame_type?: unknown;
  sort_order?: unknown;
  plan_code?: unknown;
  payload?: unknown;
};

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
  "auth_collage_image",
  "onboarding_stack_image",
  "subscription_plan_landing",
  "welcome_gift_landing",
];
const PLAN_CODES: CmsPlanCode[] = ["guest", "segna_plus", "segna_x"];

function isFrameType(v: unknown): v is CmsFrameType {
  return typeof v === "string" && (FRAME_TYPES as string[]).includes(v);
}

function isPlanCode(v: unknown): v is CmsPlanCode {
  return typeof v === "string" && (PLAN_CODES as string[]).includes(v);
}

function parseRows(data: unknown): CmsFrameRow[] {
  if (!Array.isArray(data)) return [];
  const out: CmsFrameRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as RpcFrame;
    const id = typeof r.id === "string" ? r.id : null;
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

async function fetchCmsSectionFramesRawDirect(
  supabase: StorageSignClient,
  sectionKey: string,
): Promise<CmsFrameRow[]> {
  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
  const { data, error } = await rpc.rpc("get_cms_section_frames", { p_section_key: sectionKey });
  if (error) throw new Error(error.message ?? "get_cms_section_frames failed");
  return parseRows(data);
}

export async function fetchCmsSectionFramesRaw(
  supabase: StorageSignClient,
  sectionKey: string,
): Promise<CmsFrameRow[]> {
  try {
    const cached = await fetchCmsSectionFramesRawCached(sectionKey);
    if (cached != null) return parseRows(cached);
  } catch {
    /* repli session ci-dessous */
  }
  return fetchCmsSectionFramesRawDirect(supabase, sectionKey);
}

/**
 * Charge les frames publiées pour une section, avec URLs Storage signées.
 */
export async function fetchCmsSectionFramesResolved(
  supabase: StorageSignClient,
  sectionKey: string,
  signTtlSeconds = CMS_SIGNED_URL_TTL_SECONDS,
): Promise<CmsFrameRow[]> {
  try {
    const rows = await fetchCmsSectionFramesRaw(supabase, sectionKey);
    return resolveCmsFrameRowsStorageUrls(rows, cmsStorageSignClient(supabase), signTtlSeconds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rpcMissing =
      msg.includes("Could not find the function") ||
      msg.includes("schema cache") ||
      /PGRST202|42883/i.test(msg);
    if (rpcMissing) {
      if (process.env.NODE_ENV === "development") {
        console.info(
          `[CMS] RPC get_cms_section_frames absente — appliquer la migration segna-app/supabase/migrations/20260502140000_cms_app_sections_frames.sql (section: ${sectionKey}).`,
        );
      }
    } else if (isSupabaseTransportFailure(msg)) {
      warnCmsSupabaseUnreachable(`get_cms_section_frames "${sectionKey}"`, msg);
    } else {
      console.error("get_cms_section_frames", sectionKey, msg);
    }
    return [];
  }
}
