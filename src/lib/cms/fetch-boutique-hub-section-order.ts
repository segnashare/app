import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_BOUTIQUE_HUB_SECTION_ORDER, mergeBoutiqueHubOrder } from "@/lib/cms/boutique-hub-order";

type RpcSupabase = Pick<SupabaseClient, "rpc">;

/**
 * Ordre des blocs hub /shop (RPC `get_cms_boutique_section_order`).
 * Repli sur l’ordre historique si la RPC est absente ou vide.
 */
export async function fetchBoutiqueHubSectionOrder(supabase: RpcSupabase): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_cms_boutique_section_order");
    if (error) {
      console.warn("[CMS] get_cms_boutique_section_order:", error.message);
      return [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
    }
    if (data == null) return [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
    let raw: unknown = data as unknown;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        return [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
      }
    }
    if (Array.isArray(raw)) {
      const keys = raw.filter((x): x is string => typeof x === "string");
      return mergeBoutiqueHubOrder(keys);
    }
    return [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
  } catch (e) {
    console.warn("[CMS] get_cms_boutique_section_order failed", e);
    return [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
  }
}
