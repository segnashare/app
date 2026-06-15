const MAX_LEN = 30;

/** Slug réservé dans `item_brands` pour la saisie libre (voir migration). */
export const ITEM_BRAND_AUTRE_SLUG = "autre";

/**
 * Libellé marque « Autre » : espaces normalisés, capitalisation par mot, max 30 caractères.
 */
export function formatItemCustomBrandLabel(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const words = t.split(" ").map((w) => {
    if (!w) return "";
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
  let s = words.filter(Boolean).join(" ");
  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN).trimEnd();
  }
  return s;
}

export const ITEM_CUSTOM_BRAND_LABEL_MAX_LEN = MAX_LEN;

function firstItemBrandRelation(
  value:
    | { label?: string | null; slug?: string | null }
    | Array<{ label?: string | null; slug?: string | null }>
    | null
    | undefined,
): { label?: string | null; slug?: string | null } | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Marque affichée en liste (commande, vérification, profil, etc.). */
export function resolveItemListBrandLabel(row: {
  title?: string | null;
  item_custom_brand_label?: string | null;
  item_brands?:
    | { label?: string | null; slug?: string | null }
    | Array<{ label?: string | null; slug?: string | null }>
    | null;
}): string | null {
  const custom =
    typeof row.item_custom_brand_label === "string" ? row.item_custom_brand_label.trim() : "";
  if (custom) return custom;

  const brand = firstItemBrandRelation(row.item_brands);
  const slug = brand?.slug?.trim().toLowerCase() ?? "";
  const label = brand?.label?.trim() ?? "";
  const isAutre = slug === ITEM_BRAND_AUTRE_SLUG || label.toLowerCase() === "autre";
  if (isAutre) {
    const fromTitle = formatItemCustomBrandLabel(String(row.title ?? ""));
    if (fromTitle) return fromTitle;
  }
  return label || null;
}
