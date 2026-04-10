/** Clés reconnues pour l’ordre par défaut du panier (RPC `get_cms_panier_section_order`). */
export const DEFAULT_PANIER_SECTION_ORDER = [
  "cart_system_items",
  "cart_offers",
  "cart_system_exchange",
] as const;

export function mergePanierSectionOrder(fromRpc: string[] | null | undefined): string[] {
  if (!fromRpc?.length) return [...DEFAULT_PANIER_SECTION_ORDER];
  return fromRpc;
}
