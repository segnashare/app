export type ShopMaterialFilterOption = { id: string; label: string };

function normalizeMaterialToken(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** Slug URL → libellés matériau acceptés (insensible à la casse / accents). */
const SHOP_MATERIAL_SLUG_LABEL_ALIASES: Record<string, readonly string[]> = {
  jean: ["jean", "denim"],
  laine: ["laine", "laine merinos", "cachemire"],
  cuir: ["cuir", "daim"],
  soie: ["soie", "satin"],
  coton: ["coton", "coton bio"],
};

export function normalizeShopMaterialSlug(raw: string): string {
  return normalizeMaterialToken(raw);
}

export function shopMaterialPageTitleFromSlug(slug: string): string {
  const normalized = normalizeShopMaterialSlug(slug);
  if (!normalized) return "Matériau";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function resolveMaterialIdsForShopSlug(
  slug: string,
  materials: readonly ShopMaterialFilterOption[],
): string[] {
  const normalizedSlug = normalizeShopMaterialSlug(slug);
  if (!normalizedSlug) return [];

  const aliasLabels = SHOP_MATERIAL_SLUG_LABEL_ALIASES[normalizedSlug] ?? [normalizedSlug];
  const aliasSet = new Set(aliasLabels.map(normalizeMaterialToken));

  return materials
    .filter((material) => aliasSet.has(normalizeMaterialToken(material.label)))
    .map((material) => material.id);
}

export function isShopMaterialSlug(
  raw: string,
  materials: readonly ShopMaterialFilterOption[],
): boolean {
  return resolveMaterialIdsForShopSlug(raw, materials).length > 0;
}

export function materialSlugFromShopHref(raw: string): string | null {
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
    const seg = normalizeShopMaterialSlug(rawSeg);
    return seg || null;
  } catch {
    return null;
  }
}
