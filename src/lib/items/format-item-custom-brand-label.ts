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
