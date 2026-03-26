/**
 * Poids par défaut (g) selon la catégorie affichée (libellé `item_categories.name`).
 * À ajuster selon votre grille métier (« gros » vs standard).
 */
const HEAVY_CATEGORY_REGEX =
  /valise|bagage|chaussure|botte|basket|\bsac(s)?\b|\bsac\s|sac à|sacoche volum|racket|raquette|ski|snow|carton|machine/i;

export function defaultParcelWeightGramsFromCategory(categoryLabel: string | null | undefined): number {
  if (!categoryLabel?.trim()) return 500;
  const n = categoryLabel.normalize("NFD").replace(/\p{M}/gu, "");
  return HEAVY_CATEGORY_REGEX.test(n) ? 1000 : 500;
}

/** Pochette / grand format courrier : L × l (cm) ; épaisseur mini pliée pour MR. */
export const DEFAULT_POUCH_LENGTH_CM = 45;
export const DEFAULT_POUCH_WIDTH_CM = 55;
/** Épaisseur réaliste d’une pochette pliée (MR attend souvent ≥ 1 cm). */
export const DEFAULT_POUCH_DEPTH_CM = 2;
