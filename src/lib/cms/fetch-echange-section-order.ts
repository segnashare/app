import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_ECHANGE_SECTION_ORDER, mergeEchangeSectionOrder } from "@/lib/cms/echange-section-order";

type RpcSupabase = Pick<SupabaseClient, "rpc">;

/**
 * Ordre des blocs page Échange (RPC `get_cms_echange_section_order`).
 * Repli sur l’ordre par défaut si la RPC est absente ou vide.
 */
export async function fetchEchangeSectionOrder(supabase: RpcSupabase): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_cms_echange_section_order");
    if (error) {
      console.warn("[CMS] get_cms_echange_section_order:", error.message);
      return [...DEFAULT_ECHANGE_SECTION_ORDER];
    }
    if (data == null) return [...DEFAULT_ECHANGE_SECTION_ORDER];
    let raw: unknown = data as unknown;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        return [...DEFAULT_ECHANGE_SECTION_ORDER];
      }
    }
    if (Array.isArray(raw)) {
      const keys = raw.filter((x): x is string => typeof x === "string");
      return mergeEchangeSectionOrder(keys);
    }
    return [...DEFAULT_ECHANGE_SECTION_ORDER];
  } catch (e) {
    console.warn("[CMS] get_cms_echange_section_order failed", e);
    return [...DEFAULT_ECHANGE_SECTION_ORDER];
  }
}
