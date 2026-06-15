import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CategoryFilterOption } from "@/components/shop/ShopCatalog";

export const SHOP_CATALOG_FILTER_KINDS = ["brand", "material", "category", "color", "size"] as const;

export type ShopCatalogFilterKind = (typeof SHOP_CATALOG_FILTER_KINDS)[number];

export const SHOP_CATALOG_FILTER_KIND_LABELS: Record<ShopCatalogFilterKind, string> = {
  brand: "Marque",
  material: "Matériau",
  category: "Catégorie",
  color: "Couleur",
  size: "Taille",
};

export function isShopCatalogFilterKind(raw: string): raw is ShopCatalogFilterKind {
  return (SHOP_CATALOG_FILTER_KINDS as readonly string[]).includes(raw);
}

export function normalizeShopCatalogFilterIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function buildShopCatalogFilterHref(
  kind: ShopCatalogFilterKind,
  ids: readonly string[],
): string {
  const clean = normalizeShopCatalogFilterIds(ids);
  if (clean.length === 0) return "/shop";
  return `/shop/f/${kind}?ids=${clean.map(encodeURIComponent).join(",")}`;
}

export function parseShopCatalogFilterHref(
  raw: string,
): { kind: ShopCatalogFilterKind; ids: string[] } | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const pathname =
      s.startsWith("http://") || s.startsWith("https://")
        ? new URL(s).pathname
        : (s.split("#")[0]?.split("?")[0] ?? "");
    const query =
      s.startsWith("http://") || s.startsWith("https://")
        ? new URL(s).searchParams
        : new URL(s.startsWith("/") ? `https://x${s}` : `https://x/${s}`).searchParams;
    const path = pathname.replace(/\/+$/, "").replace(/^\/+/, "");
    const m = path.match(/^shop\/f\/([^/]+)$/i);
    const kindRaw = m?.[1]?.trim().toLowerCase() ?? "";
    if (!isShopCatalogFilterKind(kindRaw)) return null;
    const idsParam = query.get("ids")?.trim() ?? "";
    const ids = normalizeShopCatalogFilterIds(idsParam.split(/[\s,]+/));
    if (ids.length === 0) return null;
    return { kind: kindRaw, ids };
  } catch {
    return null;
  }
}

function getCategoryPath(categories: CategoryFilterOption[], id: string): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path: string[] = [];
  let cur = byId.get(id);
  while (cur) {
    path.unshift(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

function itemMatchesCategoryFilter(
  itemCategoryId: string | null | undefined,
  filterCategoryId: string,
  categories: CategoryFilterOption[],
): boolean {
  if (!itemCategoryId) return false;
  return getCategoryPath(categories, itemCategoryId).includes(filterCategoryId);
}

export function itemMatchesShopCatalogFilter(
  item: ShopCatalogItem,
  kind: ShopCatalogFilterKind,
  ids: readonly string[],
  categories: CategoryFilterOption[] = [],
): boolean {
  const allow = new Set(normalizeShopCatalogFilterIds(ids));
  if (allow.size === 0) return false;

  switch (kind) {
    case "brand":
      return Boolean(item.item_brand_id && allow.has(item.item_brand_id));
    case "material":
      return Boolean(item.item_materiaux_id && allow.has(item.item_materiaux_id));
    case "color":
      return Boolean(item.item_couleur_id && allow.has(item.item_couleur_id));
    case "size":
      return Boolean(item.item_size_id && allow.has(item.item_size_id));
    case "category":
      if (!item.item_category_id) return false;
      for (const categoryId of allow) {
        if (itemMatchesCategoryFilter(item.item_category_id, categoryId, categories)) return true;
      }
      return false;
    default:
      return false;
  }
}

export function filterShopCatalogItemsByFilter(
  items: ShopCatalogItem[],
  kind: ShopCatalogFilterKind,
  ids: readonly string[],
  categories: CategoryFilterOption[] = [],
): ShopCatalogItem[] {
  return items.filter((item) => itemMatchesShopCatalogFilter(item, kind, ids, categories));
}

export function buildShopCatalogFilterPageTitle(
  kind: ShopCatalogFilterKind,
  ids: readonly string[],
  labelById: ReadonlyMap<string, string>,
): string {
  const clean = normalizeShopCatalogFilterIds(ids);
  const labels = clean
    .map((id) => labelById.get(id)?.trim())
    .filter((label): label is string => Boolean(label));

  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  if (labels.length > 2) return `${labels.slice(0, 2).join(", ")}…`;

  const kindLabel = SHOP_CATALOG_FILTER_KIND_LABELS[kind];
  return kindLabel;
}
