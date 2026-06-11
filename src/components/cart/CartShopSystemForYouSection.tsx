"use client";

import { useMemo } from "react";

import { useCartShopHubUi } from "@/components/cart/CartShopHubUiContext";
import {
  emptyShopCatalogFilters,
  ItemRailTwoUp,
  type ShopCatalogItem,
} from "@/components/shop/ShopCatalog";

const CART_FOR_YOU_SEARCH_STATE = {
  search: "",
  sortMode: "recent" as const,
  heartsOnly: false,
  disponiblesOnly: false,
  filters: emptyShopCatalogFilters,
};

function pickSectionItemsNotLiked(
  initialItems: ShopCatalogItem[],
  likedSet: Set<string>,
  start: number,
  count: number,
): ShopCatalogItem[] {
  const pool = initialItems.filter((item) => !likedSet.has(item.id));
  if (pool.length === 0) return [];
  const out: ShopCatalogItem[] = [];
  for (let i = 0; i < Math.min(count, Math.max(count, pool.length)); i += 1) {
    out.push(pool[(start + i) % pool.length]);
  }
  return out;
}

/** Même logique que le hub boutique (`shop_system_for_you`) : marques filtrées vides sur le panier → fallback catalogue. */
function likelyItemsForCart(
  initialItems: ShopCatalogItem[],
  likedSet: Set<string>,
): ShopCatalogItem[] {
  const notLiked = (items: ShopCatalogItem[]) => items.filter((item) => !likedSet.has(item.id));
  const brandIds = CART_FOR_YOU_SEARCH_STATE.filters.brandIds;
  const byBrand = initialItems.filter(
    (item) => item.item_brand_id && brandIds.includes(item.item_brand_id),
  );
  const fromBrand = notLiked(byBrand);
  if (fromBrand.length > 0) return fromBrand;
  return notLiked(initialItems);
}

type CartShopSystemForYouSectionProps = {
  /** Échantillon catalogue (RPC `get_shop_catalog_items`), aligné boutique. */
  catalogItems: ShopCatalogItem[];
};

/**
 * Bloc AUTO « Susceptibles de vous plaire » (`shop_system_for_you`) lorsqu’il est placé sur la page panier (CMS).
 */
export function CartShopSystemForYouSection({ catalogItems }: CartShopSystemForYouSectionProps) {
  const {
    coverUrlById,
    likedSet,
    likeBusyIds,
    cartBusyIds,
    localCartItemIds,
    handleToggleLike,
    handleToggleCart,
  } = useCartShopHubUi();

  const railItems = useMemo(() => {
    const likely = likelyItemsForCart(catalogItems, likedSet);
    const picked =
      likely.length > 0 ? likely : pickSectionItemsNotLiked(catalogItems, likedSet, 4, 10);
    return picked.slice(0, 10);
  }, [catalogItems, likedSet]);

  if (railItems.length === 0) return null;

  return (
    <div className="bg-white py-4">
      <ItemRailTwoUp
        title="Pièces susceptibles de vous plaire"
        items={railItems}
        sectionHref="/shop/for-you"
        coverUrlById={coverUrlById}
        shimmerDurationSec={2.85}
        cartItemIds={localCartItemIds}
        likedSet={likedSet}
        likeBusyIds={likeBusyIds}
        cartBusyIds={cartBusyIds}
        onToggleLike={handleToggleLike}
        onToggleCart={handleToggleCart}
        searchState={CART_FOR_YOU_SEARCH_STATE}
        itemFromQuery="cart"
        skipCatalogNavigationPersist
        sectionInsetScroll
      />
    </div>
  );
}
