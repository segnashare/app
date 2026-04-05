import type { CmsFrameRow } from "@/lib/cms/cms-types";

/** Même forme que `CategoryFilterOption` (évite import circulaire avec ShopCatalog). */
export type ShopCategoryTreeNode = { id: string; label: string; parentId: string | null };

/** Ordre d’affichage sur le hub boutique (URLs `/shop/{slug}`). */
export const SHOP_DEPARTMENT_SLUG_ORDER = ["vetements", "accessoires", "chaussures", "sacs"] as const;

export type ShopDepartmentSlug = (typeof SHOP_DEPARTMENT_SLUG_ORDER)[number];

export const SHOP_DEPARTMENT_PAGE_TITLE: Record<ShopDepartmentSlug, string> = {
  vetements: "Vêtements",
  accessoires: "Accessoires",
  chaussures: "Chaussures",
  sacs: "Sacs",
};

function normalizeCategoryLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** Libellés racine possibles en base → slug département (parent uniquement). */
const ROOT_LABEL_TO_SLUG: Record<string, ShopDepartmentSlug> = {
  vetements: "vetements",
  vetement: "vetements",
  accessoires: "accessoires",
  accessoire: "accessoires",
  chaussures: "chaussures",
  chaussure: "chaussures",
  sacs: "sacs",
  sac: "sacs",
  maroquinerie: "sacs",
};

export function departmentSlugFromRootLabel(label: string): ShopDepartmentSlug | null {
  const key = normalizeCategoryLabel(label);
  return ROOT_LABEL_TO_SLUG[key] ?? null;
}

/** Racines département présentes en base (parentId null + libellé reconnu). */
export function departmentRootsBySlug(categories: ShopCategoryTreeNode[]): Map<ShopDepartmentSlug, ShopCategoryTreeNode> {
  const map = new Map<ShopDepartmentSlug, ShopCategoryTreeNode>();
  for (const c of categories) {
    if (c.parentId != null) continue;
    const slug = departmentSlugFromRootLabel(c.label);
    if (!slug || map.has(slug)) continue;
    map.set(slug, c);
  }
  return map;
}

/** Remonte aux parents jusqu’à la racine puis renvoie le slug département si reconnu. */
/** Slug département depuis une URL ou un chemin du type `/shop/vetements`. */
export function departmentSlugFromShopHref(raw: string): ShopDepartmentSlug | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const pathname =
      s.startsWith("http://") || s.startsWith("https://")
        ? new URL(s).pathname
        : (s.split("?")[0]?.split("#")[0] ?? "");
    /** Tolère `/shop/x`, `shop/x` (saisie BO sans slash initial). */
    const path = pathname.replace(/\/+$/, "").replace(/^\/+/, "");
    const m = path.match(/(?:^|\/)shop\/([^/]+)$/i);
    const rawSeg = m?.[1];
    if (!rawSeg) return null;
    /** Même logique que les libellés catégories : « vêtements » → vetements (sinon slug non reconnu). */
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
  const byId = new Map(categories.map((c) => [c.id, c] as const));
  const seen = new Set<string>();
  let id: string | null = categoryId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = byId.get(id);
    if (!node) return null;
    if (node.parentId == null) {
      return departmentSlugFromRootLabel(node.label);
    }
    id = node.parentId;
  }
  return null;
}

/** IDs catégorie (racine + descendants) pour filtrer le catalogue sur un département. */
export function collectDescendantCategoryIds(
  rootId: string,
  categories: ShopCategoryTreeNode[],
): Set<string> {
  const byParent = new Map<string | null, string[]>();
  for (const c of categories) {
    const p = c.parentId;
    const arr = byParent.get(p) ?? [];
    arr.push(c.id);
    byParent.set(p, arr);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    out.add(cur);
    const children = byParent.get(cur) ?? [];
    for (const ch of children) stack.push(ch);
  }
  return out;
}

export type ShopDepartmentHubCard = {
  slug: ShopDepartmentSlug;
  label: string;
  /** Racine `item_categories` pour ce département ; null si absente en base (carte CMS affichée quand même). */
  rootCategoryId: string | null;
  /** Frame `shop_link_card` source : rendu app = même bloc que les autres grandes cartes (payload CMS). */
  linkFrame?: CmsFrameRow;
};

/**
 * Rail hub : uniquement les cartes définies par les frames CMS publiées (grande carte lien ou ref. catégorie).
 * Pas de complément automatique depuis l’arbre catégories — aligné sur le contenu édité en back-office.
 */
export function buildShopDepartmentHubRail(
  categories: ShopCategoryTreeNode[],
  cmsCategoryRefFrames: CmsFrameRow[],
): ShopDepartmentHubCard[] {
  const roots = departmentRootsBySlug(categories);
  /** Slugs déjà couverts par une grande carte lien (évite doublon avec shop_category_ref). */
  const slugUsedByLinkCard = new Set<ShopDepartmentSlug>();
  /** Un seul shop_category_ref par slug département. */
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
      /**
       * Ne pas dédupliquer par slug entre plusieurs shop_link_card : le BO peut avoir copié la même URL
       * par erreur, mais surtout chaque frame publiée doit produire une carte (sinon une seule image réseau).
       * Les doublons de slug restent visibles jusqu’à correction des liens dans le CMS.
       */
      const root = roots.get(slug);
      const titleFromPayload =
        typeof f.payload.title === "string" ? f.payload.title.trim() : "";
      slugUsedByLinkCard.add(slug);
      /**
       * Avant : on exigeait une racine catégorie en base (`roots.get(slug)`), sinon la frame était ignorée.
       * Résultat : une seule carte (ex. Vêtements) si les autres départements n’existent pas comme racines.
       * Les grandes cartes CMS portent déjà titre + lien + visuel : on les garde même sans racine.
       */
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

