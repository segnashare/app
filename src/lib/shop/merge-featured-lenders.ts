import type { ShopFeaturedLender } from "@/components/shop/ShopCatalog";
import { padFeaturedLendersToNine } from "@/lib/shop/placeholder-lenders";

const TARGET = 9;

/**
 * Grille « supers prêteuses » : 9 emplacements factices par défaut,
 * remplacés un par un par des vrais membres (dans l’ordre) quand disponibles.
 */
export function mergeFeaturedLendersReplacingFaux(
  fauxSlots: ShopFeaturedLender[],
  realMembers: ShopFeaturedLender[],
): ShopFeaturedLender[] {
  const faux = padFeaturedLendersToNine(fauxSlots).slice(0, TARGET);
  return Array.from({ length: TARGET }, (_, index) => realMembers[index] ?? faux[index]!);
}

/** Membre réel (UUID) avec lien /membre — hors factices et placeholders. */
export function isShopFeaturedRealMember(lender: ShopFeaturedLender): boolean {
  return !lender.isPlaceholder && !lender.skipMemberProfileLink && !lender.userId.startsWith("__");
}
