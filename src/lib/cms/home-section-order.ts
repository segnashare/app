/** Clés reconnues pour l’ordre par défaut de l’accueil (RPC `get_cms_home_section_order`). */
export const DEFAULT_HOME_SECTION_ORDER = [
  "home_system_hero",
  "home_system_nouveautes",
  "home_system_feed",
] as const;

export const HOME_NATIVE_SECTION_KEYS = new Set<string>(DEFAULT_HOME_SECTION_ORDER);

const REMOVED_HOME_SECTION_KEYS = new Set(["home_system_style_looks"]);

export function mergeHomeSectionOrder(fromRpc: string[] | null | undefined): string[] {
  const filterRemoved = (keys: string[]) => keys.filter((key) => !REMOVED_HOME_SECTION_KEYS.has(key));
  if (!fromRpc?.length) return [...DEFAULT_HOME_SECTION_ORDER];
  return filterRemoved(fromRpc);
}
