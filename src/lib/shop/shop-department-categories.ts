import type { CmsFrameRow } from "@/lib/cms/cms-types";

export type ShopCategoryTreeNode = { id: string; label: string; sortOrder?: number };

export const SHOP_FLAT_CATEGORY_SLUG_ORDER = [
  "robes",
  "hauts",
  "vestes-gilets",
  "manteaux",
  "jupes",
  "pantalons",
  "ensembles",
  "shorts",
  "accessoires",
  "chaussures",
  "sacs",
] as const;

export type ShopFlatCategorySlug = (typeof SHOP_FLAT_CATEGORY_SLUG_ORDER)[number];

/** Rayon CMS `/shop/vetements` : tout le vestiaire hors accessoires / chaussures / sacs. */
export const SHOP_LEGACY_DEPARTMENT_SLUGS = ["vetements"] as const;

export const SHOP_ACCESSORY_DEPARTMENT_SLUGS = ["accessoires", "chaussures", "sacs"] as const;

export const SHOP_DEPARTMENT_SLUG_ORDER = [
  ...SHOP_FLAT_CATEGORY_SLUG_ORDER,
  ...SHOP_LEGACY_DEPARTMENT_SLUGS,
] as const;

export type ShopDepartmentSlug = (typeof SHOP_DEPARTMENT_SLUG_ORDER)[number];

export const SHOP_DEPARTMENT_PAGE_TITLE: Record<ShopDepartmentSlug, string> = {
  robes: "Robes",
  hauts: "Hauts",
  "vestes-gilets": "Vestes & gilets",
  manteaux: "Manteaux",
  jupes: "Jupes",
  pantalons: "Pantalons",
  ensembles: "Ensembles",
  shorts: "Shorts",
  accessoires: "Accessoires",
  vetements: "Vêtements",
  chaussures: "Chaussures",
  sacs: "Sacs",
};

function normalizeCategoryLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function departmentSlugFromRootLabel(label: string): ShopDepartmentSlug | null {
  const key = normalizeCategoryLabel(label);
  if ((SHOP_DEPARTMENT_SLUG_ORDER as readonly string[]).includes(key)) {
    return key as ShopDepartmentSlug;
  }
  return null;
}

export function departmentRootsBySlug(categories: ShopCategoryTreeNode[]): Map<ShopDepartmentSlug, ShopCategoryTreeNode> {
  const map = new Map<ShopDepartmentSlug, ShopCategoryTreeNode>();
  for (const c of categories) {
    const slug = departmentSlugFromRootLabel(c.label);
    if (!slug || map.has(slug)) continue;
    map.set(slug, c);
  }
  return map;
}

export function departmentSlugFromShopHref(raw: string): ShopDepartmentSlug | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const pathname =
      s.startsWith("http://") || s.startsWith("https://")
        ? new URL(s).pathname
        : (s.split("?")[0]?.split("#")[0] ?? "");
    const path = pathname.replace(/\/+$/, "").replace(/^\/+/, "");
    const m = path.match(/(?:^|\/)shop\/([^/]+)$/i);
    const rawSeg = m?.[1];
    if (!rawSeg) return null;
    const seg = normalizeCategoryLabel(rawSeg);
    if (!seg) return null;
    return (SHOP_DEPARTMENT_SLUG_ORDER as readonly string[]).includes(seg)
      ? (seg as ShopDepartmentSlug)
      : null;
  } catch {
    return null;
  }
}

export function departmentSlugForCategoryId(
  categoryId: string,
  categories: ShopCategoryTreeNode[],
): ShopDepartmentSlug | null {
  const node = categories.find((c) => c.id === categoryId);
  if (!node) return null;
  return departmentSlugFromRootLabel(node.label);
}

export function collectDescendantCategoryIds(
  rootId: string,
  _categories: ShopCategoryTreeNode[],
): Set<string> {
  return new Set([rootId]);
}

export function itemMatchesShopDepartmentSlug(
  itemCategoryId: string | null | undefined,
  slug: ShopDepartmentSlug,
  categories: ShopCategoryTreeNode[],
): boolean {
  if (!itemCategoryId) return false;
  const ids = categoryIdsForDepartmentSlug(slug, categories);
  return ids.includes(itemCategoryId);
}

/** Ids à filtrer pour un rayon hub (`/shop/vetements` → tout sauf accessoires/chaussures/sacs). */
export function categoryIdsForDepartmentSlug(
  slug: ShopDepartmentSlug,
  categories: ShopCategoryTreeNode[],
): string[] {
  const accessory = new Set<string>(SHOP_ACCESSORY_DEPARTMENT_SLUGS);
  if (slug === "vetements") {
    return categories
      .filter((c) => {
        const s = departmentSlugFromRootLabel(c.label);
        return !s || !accessory.has(s);
      })
      .map((c) => c.id);
  }
  const root = departmentRootsBySlug(categories).get(slug);
  return root ? [root.id] : [];
}

export type ShopDepartmentHubCard = {
  slug: ShopDepartmentSlug;
  label: string;
  rootCategoryId: string | null;
  linkFrame?: CmsFrameRow;
};

export function buildShopDepartmentHubRail(
  categories: ShopCategoryTreeNode[],
  cmsCategoryRefFrames: CmsFrameRow[],
): ShopDepartmentHubCard[] {
  const roots = departmentRootsBySlug(categories);
  const slugUsedByLinkCard = new Set<ShopDepartmentSlug>();
  const seenCategoryRefSlug = new Set<ShopDepartmentSlug>();
  const out: ShopDepartmentHubCard[] = [];

  const sortedFrames = [...cmsCategoryRefFrames].sort(
    (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
  );

  for (const f of sortedFrames) {
    if (f.frame_type === "shop_link_card") {
      const href = typeof f.payload.target_url === "string" ? f.payload.target_url.trim() : "";
      const slug = href ? departmentSlugFromShopHref(href) : null;
      if (!slug) continue;
      const root = roots.get(slug);
      const titleFromPayload =
        typeof f.payload.title === "string" ? f.payload.title.trim() : "";
      slugUsedByLinkCard.add(slug);
      out.push({
        slug,
        label: titleFromPayload || root?.label || SHOP_DEPARTMENT_PAGE_TITLE[slug],
        rootCategoryId: root?.id ?? null,
        linkFrame: f,
      });
      continue;
    }
    if (f.frame_type !== "shop_category_ref") continue;
    const id = typeof f.payload.category_id === "string" ? f.payload.category_id.trim() : "";
    if (!id) continue;
    const slug = departmentSlugForCategoryId(id, categories);
    if (!slug || seenCategoryRefSlug.has(slug) || slugUsedByLinkCard.has(slug)) continue;
    const root = roots.get(slug);
    if (!root) continue;
    seenCategoryRefSlug.add(slug);
    out.push({ slug, label: root.label, rootCategoryId: root.id });
  }

  return out;
}
