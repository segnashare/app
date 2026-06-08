"use client";

import { useMemo } from "react";

import { useCartShopHubUi } from "@/components/cart/CartShopHubUiContext";
import {
  emptyShopCatalogFilters,
  ItemRailTwoUp,
  type ShopCatalogItem,
} from "@/components/shop/ShopCatalog";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const CART_OUTFIT_SEARCH_STATE = {
  search: "",
  sortMode: "recent" as const,
  heartsOnly: false,
  disponiblesOnly: true,
  filters: emptyShopCatalogFilters,
};

type CartOutfitSuggestionsSectionProps = {
  items: ShopCatalogItem[];
  /** Version plus compacte pour le checkout (max 4 pièces). */
  compact?: boolean;
};

export function CartOutfitSuggestionsSection({ items, compact = false }: CartOutfitSuggestionsSectionProps) {
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
    const available = items.filter((item) => item.status === "available" || item.status === "in_cart");
    return compact ? available.slice(0, 4) : available.slice(0, 10);
  }, [compact, items]);

  if (railItems.length === 0) return null;

  return (
    <div className={cn("bg-white", compact ? "px-5 py-3" : "px-5 py-4")}>
      <h2
        className={cn(
          segnaPlayfairDisplay.className,
          SEGNA_SECTION_TITLE_CLASSNAME,
          compact && "text-[22px]",
        )}
      >
        Complétez votre tenue
      </h2>
      <div className={cn(compact ? "mt-2" : "mt-3")}>
        <ItemRailTwoUp
          title=""
          items={railItems}
          coverUrlById={coverUrlById}
          shimmerDurationSec={2.85}
          cartItemIds={localCartItemIds}
          likedSet={likedSet}
          likeBusyIds={likeBusyIds}
          cartBusyIds={cartBusyIds}
          onToggleLike={handleToggleLike}
          onToggleCart={handleToggleCart}
          searchState={CART_OUTFIT_SEARCH_STATE}
          itemFromQuery="cart"
          skipCatalogNavigationPersist
          hideSectionHeader
        />
      </div>
    </div>
  );
}
