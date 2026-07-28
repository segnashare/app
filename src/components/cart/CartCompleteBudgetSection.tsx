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

const CART_COMPLETE_BUDGET_SEARCH_STATE = {
  search: "",
  sortMode: "recent" as const,
  heartsOnly: false,
  disponiblesOnly: true,
  filters: emptyShopCatalogFilters,
};

type CartCompleteBudgetSectionProps = {
  remainingPoints: number;
  suggestionItems?: ShopCatalogItem[];
  cartItemIds?: string[];
};

function pickBudgetRailItems(
  items: ShopCatalogItem[],
  excludedIds: Set<string>,
  maxPoints: number,
): ShopCatalogItem[] {
  const seen = new Set<string>();
  const fits: ShopCatalogItem[] = [];
  const rest: ShopCatalogItem[] = [];

  for (const item of items) {
    if (!item.id || excludedIds.has(item.id) || seen.has(item.id)) continue;
    if (item.status !== "available" && item.status !== "in_cart") continue;
    seen.add(item.id);
    const points = item.price_points ?? 0;
    if (points > 0 && points <= maxPoints) fits.push(item);
    else if (points > 0) rest.push(item);
    if (fits.length >= 10) break;
  }

  return (fits.length > 0 ? fits : rest).slice(0, 10);
}

/** Budget SegnaX restant + rail d’items pour compléter le panier. */
export function CartCompleteBudgetSection({
  remainingPoints,
  suggestionItems = [],
  cartItemIds = [],
}: CartCompleteBudgetSectionProps) {
  const {
    coverUrlById,
    likedSet,
    likeBusyIds,
    cartBusyIds,
    localCartItemIds,
    handleToggleLike,
    handleToggleCart,
  } = useCartShopHubUi();

  const remaining = Math.max(0, Math.floor(remainingPoints));

  const railItems = useMemo(() => {
    const excluded = new Set(cartItemIds);
    for (const id of localCartItemIds) excluded.add(id);
    return pickBudgetRailItems(suggestionItems, excluded, remaining);
  }, [cartItemIds, localCartItemIds, remaining, suggestionItems]);

  if (remaining <= 0 || railItems.length === 0) return null;

  return (
    <div className="mt-5 border-t border-zinc-200 pt-5">
      <h3 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME, "leading-tight")}>
        Compléter le panier
      </h3>
      <p className="mt-1 text-[13px] leading-snug text-zinc-500">
        Il te reste{" "}
        {new Intl.NumberFormat("fr-FR", {
          style: "currency",
          currency: "EUR",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(remaining)}{" "}
        sur ton budget SegnaX.
      </p>
      <div className="-mx-5 mt-3">
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
          searchState={CART_COMPLETE_BUDGET_SEARCH_STATE}
          itemFromQuery="cart"
          skipCatalogNavigationPersist
          hideSectionHeader
          hideLikeAction
          compactCard
          sectionInsetScroll
          squarePhotoFrame
        />
      </div>
    </div>
  );
}
