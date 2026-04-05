import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import {
  collectDescendantCategoryIds,
  departmentRootsBySlug,
  SHOP_DEPARTMENT_PAGE_TITLE,
  SHOP_DEPARTMENT_SLUG_ORDER,
  type ShopCategoryTreeNode,
  type ShopDepartmentSlug,
} from "@/lib/shop/shop-department-categories";

const LUXE_RE = /chanel|dior|saint|louis|herm|celine|balen|givenchy/i;

export const SHOP_SECTION_SLUGS = [
  "discover",
  "liked",
  "for-you",
  "popular",
  "preferred-brands",
  "deals",
  "lenders",
  "french",
  "available",
  ...SHOP_DEPARTMENT_SLUG_ORDER,
] as const;

export type ShopSectionSlug = (typeof SHOP_SECTION_SLUGS)[number];

export const SHOP_SECTION_TITLES: Record<ShopSectionSlug, string> = {
  discover: "À découvrir sur Segna",
  liked: "Pièces likées",
  "for-you": "Pièces susceptibles de vous plaire",
  popular: "Les pièces les plus likées",
  "preferred-brands": "Vos marques préférées",
  deals: "Les bons coups",
  lenders: "Nos supers prêteuses",
  french: "Mode à la française",
  available: "Disponibles",
  vetements: SHOP_DEPARTMENT_PAGE_TITLE.vetements,
  accessoires: SHOP_DEPARTMENT_PAGE_TITLE.accessoires,
  chaussures: SHOP_DEPARTMENT_PAGE_TITLE.chaussures,
  sacs: SHOP_DEPARTMENT_PAGE_TITLE.sacs,
};

function parseCatalogPayload(data: unknown): ShopCatalogItem[] {
  const p = (data ?? { items: [] }) as { items?: ShopCatalogItem[] };
  return Array.isArray(p.items) ? p.items : [];
}

type LoaderCtx = {
  userId: string;
  featuredLenderItemIds: string[];
  /** Ranks utilisateur (page « marques préférées ») */
  preferredBrandIds?: string[];
  /** Arbre catégories (pages `/shop/vetements` …) */
  categoryRows?: ShopCategoryTreeNode[];
};

function filterItemsByDepartmentSlug(
  items: ShopCatalogItem[],
  slug: ShopDepartmentSlug,
  categoryRows: ShopCategoryTreeNode[] | undefined,
): ShopCatalogItem[] {
  if (!categoryRows?.length) return [];
  const roots = departmentRootsBySlug(categoryRows);
  const root = roots.get(slug);
  if (!root) return [];
  const allowed = collectDescendantCategoryIds(root.id, categoryRows);
  return items.filter((i) => i.item_category_id != null && allowed.has(i.item_category_id));
}

/**
 * Charge la sélection serveur pour une page /shop/[slug] (filtres + recherche client sur ce sous-ensemble).
 */
export async function loadShopSectionItems(
  supabase: unknown,
  slug: ShopSectionSlug,
  ctx: LoaderCtx,
): Promise<ShopCatalogItem[]> {
  const anySb = supabase as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  switch (slug) {
    case "popular": {
      const res = await anySb.rpc("get_shop_most_liked_fraction", { p_fraction: 0.1 });
      if (res.error) return [];
      return parseCatalogPayload(res.data);
    }
    case "discover": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: 200 });
      if (res.error) return [];
      return parseCatalogPayload(res.data);
    }
    case "liked": {
      const res = await anySb.rpc("get_shop_user_favorite_items", { p_limit: 200 });
      if (res.error) return [];
      return parseCatalogPayload(res.data);
    }
    case "for-you": {
      const res = await anySb.rpc("get_shop_catalog_excluding_user_favorites", { p_limit: 200 });
      if (res.error) return [];
      return parseCatalogPayload(res.data);
    }
    case "deals": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: 200 });
      if (res.error) return [];
      return parseCatalogPayload(res.data).slice(18);
    }
    case "french": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: 200 });
      if (res.error) return [];
      return parseCatalogPayload(res.data).filter((i) => LUXE_RE.test(i.brand_label ?? ""));
    }
    case "available": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: 200 });
      if (res.error) return [];
      return parseCatalogPayload(res.data).filter((i) => i.status === "available" || i.status === "in_cart");
    }
    case "lenders": {
      if (ctx.featuredLenderItemIds.length === 0) return [];
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: 200 });
      if (res.error) return [];
      const allow = new Set(ctx.featuredLenderItemIds);
      return parseCatalogPayload(res.data).filter((i) => allow.has(i.id));
    }
    case "preferred-brands": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: 200 });
      if (res.error) return [];
      const all = parseCatalogPayload(res.data);
      const brandIds = ctx.preferredBrandIds ?? [];
      if (brandIds.length === 0) {
        return all.slice(2, 14);
      }
      const set = new Set(brandIds);
      return all.filter((i) => i.item_brand_id != null && set.has(i.item_brand_id));
    }
    case "vetements":
    case "accessoires":
    case "chaussures":
    case "sacs": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: 200 });
      if (res.error) return [];
      const all = parseCatalogPayload(res.data);
      return filterItemsByDepartmentSlug(all, slug, ctx.categoryRows);
    }
    default:
      return [];
  }
}

export function isShopSectionSlug(s: string): s is ShopSectionSlug {
  return (SHOP_SECTION_SLUGS as readonly string[]).includes(s);
}
