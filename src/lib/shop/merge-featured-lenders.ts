import type { ShopFeaturedLender } from "@/components/shop/ShopCatalog";

/** Membre réel (UUID) avec lien /membre — hors placeholders. */
export function isShopFeaturedRealMember(lender: ShopFeaturedLender): boolean {
  return !lender.isPlaceholder && !lender.skipMemberProfileLink && !lender.userId.startsWith("__");
}
