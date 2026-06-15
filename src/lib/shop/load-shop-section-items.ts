import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { SEGNA_CORPORATE_INVENTORY_USER_ID } from "@/lib/config/segna-corporate-inventory";
import {
  collectDescendantCategoryIds,
  departmentRootsBySlug,
  SHOP_DEPARTMENT_PAGE_TITLE,
  SHOP_DEPARTMENT_SLUG_ORDER,
  type ShopCategoryTreeNode,
  type ShopDepartmentSlug,
} from "@/lib/shop/shop-department-categories";

const LUXE_RE = /chanel|dior|saint|louis|herm|celine|balen|givenchy/i;
const SHOP_SECTION_ITEMS_LIMIT = 96;

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
  "collection-segna",
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
  "collection-segna": "Collection Segna",
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

type SegnaCollectionItemRow = {
  id?: string;
  title?: string | null;
  description?: string | null;
  price_points?: number | null;
  status?: string | null;
  photos?: unknown;
  item_category_id?: string | null;
  item_size_id?: string | null;
  item_brand_id?: string | null;
  item_couleur_id?: string | null;
  item_materiaux_id?: string | null;
  item_custom_brand_label?: string | null;
  item_categories?: { name?: string | null } | { name?: string | null }[] | null;
  sizes?: { label?: string | null } | { label?: string | null }[] | null;
  item_materiaux?: { label?: string | null } | { label?: string | null }[] | null;
  item_couleurs?: { label?: string | null } | { label?: string | null }[] | null;
  item_brands?: { label?: string | null; slug?: string | null } | { label?: string | null; slug?: string | null }[] | null;
};

type SegnaCollectionConditionRow = {
  item_id?: string | null;
  condition_score?: string | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function conditionLabelFromScore(score: string | null): string | null {
  switch (score) {
    case "neuf_etiquette":
      return "Neuf avec étiquette";
    case "excellent":
      return "Excellent état";
    case "tres_bon":
      return "Très bon état";
    case "bon":
      return "Bon état";
    case "acceptable":
      return "Acceptable";
    case "degrade":
      return "Dégradé";
    default:
      return score;
  }
}

async function loadSegnaCollectionItems(supabase: unknown): Promise<ShopCatalogItem[]> {
  const anySb = supabase as {
    from: (table: string) => any;
  };

  const { data, error } = await anySb
    .from("items")
    .select(
      [
        "id",
        "title",
        "description",
        "price_points",
        "status",
        "photos",
        "item_category_id",
        "item_size_id",
        "item_brand_id",
        "item_couleur_id",
        "item_materiaux_id",
        "item_custom_brand_label",
        "item_categories(name)",
        "sizes(label)",
        "item_materiaux(label)",
        "item_couleurs(label)",
        "item_brands(label,slug)",
      ].join(","),
    )
    .eq("owner_user_id", SEGNA_CORPORATE_INVENTORY_USER_ID)
    .is("deleted_at", null)
    .in("status", ["available", "in_cart", "reserved"])
    .order("updated_at", { ascending: false })
    .limit(SHOP_SECTION_ITEMS_LIMIT);

  if (error || !Array.isArray(data)) return [];

  const rows = data as SegnaCollectionItemRow[];
  const itemIds = rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  const conditionByItemId = new Map<string, string | null>();

  if (itemIds.length > 0) {
    const { data: conditionRows } = await anySb
      .from("item_condition_history")
      .select("item_id,condition_score")
      .in("item_id", itemIds)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false });

    for (const row of (Array.isArray(conditionRows) ? conditionRows : []) as SegnaCollectionConditionRow[]) {
      const itemId = typeof row.item_id === "string" ? row.item_id : null;
      if (itemId && !conditionByItemId.has(itemId)) {
        conditionByItemId.set(itemId, row.condition_score ?? null);
      }
    }
  }

  return rows
    .filter((row): row is SegnaCollectionItemRow & { id: string } => typeof row.id === "string")
    .map((row) => {
      const category = firstRelation(row.item_categories);
      const size = firstRelation(row.sizes);
      const material = firstRelation(row.item_materiaux);
      const color = firstRelation(row.item_couleurs);
      const brand = firstRelation(row.item_brands);
      const customBrand = row.item_custom_brand_label?.trim() || null;
      const otherBrandFallback = brand?.slug === "autre" ? (row.title?.trim().slice(0, 30) ?? null) : null;
      const brandLabel = customBrand || otherBrandFallback || brand?.label || null;
      const conditionScore = conditionByItemId.get(row.id) ?? null;

      return {
        id: row.id,
        title: row.title?.trim() || "Pièce Segna",
        description: row.description ?? null,
        price_points: row.price_points ?? null,
        status: row.status ?? "available",
        photos: row.photos ?? null,
        item_category_id: row.item_category_id ?? null,
        item_size_id: row.item_size_id ?? null,
        item_brand_id: row.item_brand_id ?? null,
        item_couleur_id: row.item_couleur_id ?? null,
        item_materiaux_id: row.item_materiaux_id ?? null,
        category_label: category?.name ?? null,
        size_label: size?.label ?? null,
        materials_label: material?.label ?? null,
        color_label: color?.label ?? null,
        brand_label: brandLabel,
        condition_label: conditionLabelFromScore(conditionScore),
        condition_score: conditionScore,
      };
    });
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
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
      if (res.error) return [];
      return parseCatalogPayload(res.data);
    }
    case "liked": {
      const res = await anySb.rpc("get_shop_user_favorite_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
      if (res.error) return [];
      return parseCatalogPayload(res.data);
    }
    case "for-you": {
      const res = await anySb.rpc("get_shop_catalog_excluding_user_favorites", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
      if (res.error) return [];
      return parseCatalogPayload(res.data);
    }
    case "deals": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
      if (res.error) return [];
      return parseCatalogPayload(res.data).slice(18);
    }
    case "french": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
      if (res.error) return [];
      return parseCatalogPayload(res.data).filter((i) => LUXE_RE.test(i.brand_label ?? ""));
    }
    case "available": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
      if (res.error) return [];
      return parseCatalogPayload(res.data).filter((i) => i.status === "available" || i.status === "in_cart");
    }
    case "collection-segna":
      return loadSegnaCollectionItems(supabase);
    case "lenders": {
      if (ctx.featuredLenderItemIds.length === 0) return [];
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
      if (res.error) return [];
      const allow = new Set(ctx.featuredLenderItemIds);
      return parseCatalogPayload(res.data).filter((i) => allow.has(i.id));
    }
    case "preferred-brands": {
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
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
      const res = await anySb.rpc("get_shop_catalog_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
      if (res.error) return [];
      const all = parseCatalogPayload(res.data);
      return filterItemsByDepartmentSlug(all, slug, ctx.categoryRows);
    }
    default:
      return [];
  }
}

/** Pièces catalogue filtrées par matériau(x) (`/shop/jean`, `/shop/laine`, …). */
export async function loadShopMaterialSectionItems(
  supabase: unknown,
  materialIds: string[],
): Promise<ShopCatalogItem[]> {
  const catalog = await loadShopCatalogFilterItems(supabase);
  const allow = new Set(materialIds.map((id) => id.trim()).filter(Boolean));
  if (allow.size === 0) return [];
  return catalog.filter((item) => item.item_materiaux_id != null && allow.has(item.item_materiaux_id));
}

/** Catalogue boutique (base pour pages filtre `/shop/f/...`). */
export async function loadShopCatalogFilterItems(supabase: unknown): Promise<ShopCatalogItem[]> {
  const anySb = supabase as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const res = await anySb.rpc("get_shop_catalog_items", { p_limit: SHOP_SECTION_ITEMS_LIMIT });
  if (res.error) return [];
  return parseCatalogPayload(res.data);
}

export function isShopSectionSlug(s: string): s is ShopSectionSlug {
  return (SHOP_SECTION_SLUGS as readonly string[]).includes(s);
}
