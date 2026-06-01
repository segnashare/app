/** Préfixe titre : `segna_Ma pièce test` désactive les contraintes du wizard création item. */
export const ITEM_CREATE_RELAXED_TITLE_PREFIX = "segna_";

export const ITEM_CREATE_RELAXED_MIN_PHOTOS = 0;

export function isItemCreateRelaxedByEnv(): boolean {
  return process.env.NEXT_PUBLIC_SEGNA_ITEM_CREATE_RELAX?.trim() === "1";
}

export function isItemCreateRelaxedByTitle(title: string): boolean {
  return title.trim().toLowerCase().startsWith(ITEM_CREATE_RELAXED_TITLE_PREFIX);
}

/** Mode test création item : pas de minimum photos ni champs infos obligatoires (titre requis). */
export function isItemCreateRelaxedMode(title: string): boolean {
  return isItemCreateRelaxedByEnv() || isItemCreateRelaxedByTitle(title);
}
