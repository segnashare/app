import type { ShopFeaturedLender } from "@/components/shop/ShopCatalog";

const TARGET = 9;

/** Profils décoratifs (pas d’UUID réel, pas de lien membre). */
const PLACEHOLDERS: ShopFeaturedLender[] = [
  { userId: "__segna_ph_1__", displayName: "Léa M.", avatarUrl: null, isPlaceholder: true },
  { userId: "__segna_ph_2__", displayName: "Tom H.", avatarUrl: null, isPlaceholder: true },
  { userId: "__segna_ph_3__", displayName: "Inès K.", avatarUrl: null, isPlaceholder: true },
  { userId: "__segna_ph_4__", displayName: "Raphaël D.", avatarUrl: null, isPlaceholder: true },
  { userId: "__segna_ph_5__", displayName: "Chloé P.", avatarUrl: null, isPlaceholder: true },
  { userId: "__segna_ph_6__", displayName: "Nathan B.", avatarUrl: null, isPlaceholder: true },
  { userId: "__segna_ph_7__", displayName: "Manon V.", avatarUrl: null, isPlaceholder: true },
  { userId: "__segna_ph_8__", displayName: "Julien F.", avatarUrl: null, isPlaceholder: true },
  { userId: "__segna_ph_9__", displayName: "Amélie C.", avatarUrl: null, isPlaceholder: true },
];

/**
 * Complète jusqu’à 9 entrées avec des profils factices (noms d’exemple).
 */
export function padFeaturedLendersToNine(lenders: ShopFeaturedLender[]): ShopFeaturedLender[] {
  const real = lenders.filter((l) => !l.isPlaceholder);
  if (real.length >= TARGET) return real.slice(0, TARGET);
  const need = TARGET - real.length;
  return [...real, ...PLACEHOLDERS.slice(0, need)];
}
