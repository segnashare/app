import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchEchangeSectionOrderRawCached } from "@/lib/cms/cms-data-cache";
import { DEFAULT_ECHANGE_SECTION_ORDER, mergeEchangeSectionOrder } from "@/lib/cms/echange-section-order";

type RpcSupabase = Pick<SupabaseClient, "rpc">;

function parseEchangeSectionOrderRaw(raw: unknown): string[] {
  if (raw == null) return [...DEFAULT_ECHANGE_SECTION_ORDER];
  let parsed: unknown = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return [...DEFAULT_ECHANGE_SECTION_ORDER];
    }
  }
  if (Array.isArray(parsed)) {
    const keys = parsed.filter((x): x is string => typeof x === "string");
    return mergeEchangeSectionOrder(keys);
  }
  return [...DEFAULT_ECHANGE_SECTION_ORDER];
}

/**
 * Ordre des blocs page Échange (RPC `get_cms_echange_section_order`).
 * Repli sur l’ordre par défaut si la RPC est absente ou vide.
 */
export async function fetchEchangeSectionOrder(supabase: RpcSupabase): Promise<string[]> {
  try {
    const cached = await fetchEchangeSectionOrderRawCached();
    if (cached != null) return parseEchangeSectionOrderRaw(cached);
  } catch {
    /* repli RPC session ci-dessous */
  }

  try {
    const { data, error } = await supabase.rpc("get_cms_echange_section_order");
    if (error) {
      console.warn("[CMS] get_cms_echange_section_order:", error.message);
      return [...DEFAULT_ECHANGE_SECTION_ORDER];
    }
    if (data == null) return [...DEFAULT_ECHANGE_SECTION_ORDER];
    return parseEchangeSectionOrderRaw(data);
  } catch (e) {
    console.warn("[CMS] get_cms_echange_section_order failed", e);
    return [...DEFAULT_ECHANGE_SECTION_ORDER];
  }
}
