import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_BOUTIQUE_HUB_SECTION_ORDER, mergeBoutiqueHubOrder } from "@/lib/cms/boutique-hub-order";
import { fetchBoutiqueHubSectionOrderRawCached } from "@/lib/cms/cms-data-cache";

type RpcSupabase = Pick<SupabaseClient, "rpc">;

function parseBoutiqueHubOrderRaw(raw: unknown): string[] | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  return value.filter((x): x is string => typeof x === "string");
}

/**
 * Ordre des blocs hub /shop (RPC `get_cms_boutique_section_order`).
 * Repli sur l’ordre historique si la RPC est absente ou vide.
 */
export async function fetchBoutiqueHubSectionOrder(supabase: RpcSupabase): Promise<string[]> {
  try {
    let raw: unknown;
    try {
      raw = await fetchBoutiqueHubSectionOrderRawCached();
    } catch {
      const { data, error } = await supabase.rpc("get_cms_boutique_section_order");
      if (error) {
        console.warn("[CMS] get_cms_boutique_section_order:", error.message);
        return [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
      }
      raw = data;
    }
    const keys = parseBoutiqueHubOrderRaw(raw);
    if (keys && keys.length > 0) return mergeBoutiqueHubOrder(keys);
    return [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
  } catch (e) {
    console.warn("[CMS] get_cms_boutique_section_order failed", e);
    return [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
  }
}
