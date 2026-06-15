import {
  isShopMaterialSlug,
  normalizeShopMaterialSlug,
  resolveMaterialIdsForShopSlug,
  shopMaterialPageTitleFromSlug,
  type ShopMaterialFilterOption,
} from "@/lib/shop/shop-material-slugs";
import { isShopSectionSlug, type ShopSectionSlug } from "@/lib/shop/load-shop-section-items";

export type ShopPageSlugResolution =
  | { kind: "section"; slug: ShopSectionSlug }
  | { kind: "material"; slug: string; materialIds: string[]; title: string };

export function resolveShopPageSlug(
  raw: string,
  materials: readonly ShopMaterialFilterOption[],
): ShopPageSlugResolution | null {
  const slug = raw.trim();
  if (!slug) return null;

  if (isShopSectionSlug(slug)) {
    return { kind: "section", slug };
  }

  const materialSlug = normalizeShopMaterialSlug(slug);
  if (!materialSlug || !isShopMaterialSlug(materialSlug, materials)) {
    return null;
  }

  const materialIds = resolveMaterialIdsForShopSlug(materialSlug, materials);
  if (materialIds.length === 0) return null;

  return {
    kind: "material",
    slug: materialSlug,
    materialIds,
    title: shopMaterialPageTitleFromSlug(materialSlug),
  };
}
