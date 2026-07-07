import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";

/** Fisher-Yates : copie mélangée, entrée inchangée. */
export function shuffleCatalogItems<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Ordre serveur (RPC `get_shop_catalog_items` : updated_at desc). */
export function orderCatalogItemsByServerIndex(
  items: ShopCatalogItem[],
  initialItems: ShopCatalogItem[],
): ShopCatalogItem[] {
  const indexById = new Map(initialItems.map((item, index) => [item.id, index] as const));
  return [...items].sort((a, b) => {
    const ia = indexById.get(a.id) ?? 1_000_000;
    const ib = indexById.get(b.id) ?? 1_000_000;
    return ia - ib;
  });
}

/**
 * Mélange stable pour la session : conserve l’ordre entre re-renders,
 * insère les nouvelles pièces (chargement progressif) en fin de liste mélangée.
 */
export function applyStableShuffledCatalogOrder(
  items: ShopCatalogItem[],
  orderRef: { current: string[] | null },
): ShopCatalogItem[] {
  if (items.length === 0) return items;

  const byId = new Map(items.map((item) => [item.id, item] as const));

  if (orderRef.current === null) {
    orderRef.current = shuffleCatalogItems(items).map((item) => item.id);
  } else {
    const known = new Set(orderRef.current);
    const newIds = items.map((item) => item.id).filter((id) => !known.has(id));
    if (newIds.length > 0) {
      const shuffledNew = shuffleCatalogItems(newIds.map((id) => byId.get(id)!)).map((item) => item.id);
      orderRef.current = [...orderRef.current, ...shuffledNew];
    }
    orderRef.current = orderRef.current.filter((id) => byId.has(id));
  }

  return orderRef.current
    .map((id) => byId.get(id))
    .filter((item): item is ShopCatalogItem => item != null);
}
