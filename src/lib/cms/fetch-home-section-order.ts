import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_HOME_SECTION_ORDER, mergeHomeSectionOrder } from "@/lib/cms/home-section-order";

type RpcSupabase = Pick<SupabaseClient, "rpc">;

/**
 * Ordre des blocs page Accueil (RPC `get_cms_home_section_order`).
 * Repli sur l’ordre par défaut si la RPC est absente ou vide.
 */
export async function fetchHomeSectionOrder(supabase: RpcSupabase): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_cms_home_section_order");
    if (error) {
      console.warn("[CMS] get_cms_home_section_order:", error.message);
      return [...DEFAULT_HOME_SECTION_ORDER];
    }
    if (data == null) return [...DEFAULT_HOME_SECTION_ORDER];
    let raw: unknown = data as unknown;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        return [...DEFAULT_HOME_SECTION_ORDER];
      }
    }
    if (Array.isArray(raw)) {
      const keys = raw.filter((x): x is string => typeof x === "string");
      return mergeHomeSectionOrder(keys);
    }
    return [...DEFAULT_HOME_SECTION_ORDER];
  } catch (e) {
    console.warn("[CMS] get_cms_home_section_order failed", e);
    return [...DEFAULT_HOME_SECTION_ORDER];
  }
}
