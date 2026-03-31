/** Affichage : « Taille M », pas seulement « M ». Évite le double préfixe si déjà présent. */
export function formatItemSizeLabel(size: string): string {
  const s = size.trim();
  if (!s) return s;
  if (/^taille\s+/i.test(s)) return s;
  return `Taille ${s}`;
}
