/** Clés reconnues pour le hub boutique (ordre = CMS `page_sort_order`). */
export const DEFAULT_BOUTIQUE_HUB_SECTION_ORDER = [
  "shop_section_discover",
  "shop_system_liked",
  "shop_section_categories",
  "shop_system_for_you",
  "shop_system_popular",
  "shop_section_preferred_brands",
  "shop_home_capsules",
  "shop_section_deals",
  "shop_system_lenders",
  "shop_section_french",
  "shop_system_available",
] as const;

export const BOUTIQUE_HUB_KNOWN_KEYS = new Set<string>(DEFAULT_BOUTIQUE_HUB_SECTION_ORDER);

export function mergeBoutiqueHubOrder(fromRpc: string[] | null | undefined): string[] {
  const known = [...DEFAULT_BOUTIQUE_HUB_SECTION_ORDER];
  const filtered = (fromRpc ?? []).filter((k) => BOUTIQUE_HUB_KNOWN_KEYS.has(k));
  if (filtered.length === 0) return known;
  // L’ordre vient du RPC (filtré par segment via `visible_plan_codes`). Ne pas réinjecter les blocs exclus.
  return filtered;
}
