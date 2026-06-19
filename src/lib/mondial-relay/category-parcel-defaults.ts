import { SEGNA_PARCEL_WEIGHT_GRAMS } from "@/lib/shipping/exchange-shipping-pricing";

/** Poids colis fixe (g) — indépendant de la catégorie article. */
export function defaultParcelWeightGramsFromCategory(_categoryLabel?: string | null): number {
  return SEGNA_PARCEL_WEIGHT_GRAMS;
}

/** Pochette / grand format courrier : L × l (cm) ; épaisseur mini pliée pour MR. */
export const DEFAULT_POUCH_LENGTH_CM = 45;
export const DEFAULT_POUCH_WIDTH_CM = 55;
/** Épaisseur réaliste d’une pochette pliée (MR attend souvent ≥ 1 cm). */
export const DEFAULT_POUCH_DEPTH_CM = 2;
