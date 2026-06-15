"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useCartShopHubUi } from "@/components/cart/CartShopHubUiContext";
import {
  emptyShopCatalogFilters,
  ItemRailTwoUp,
  type ShopCatalogItem,
} from "@/components/shop/ShopCatalog";
import { parseCartOutfitSuggestionsRpcData } from "@/lib/shop/fetch-cart-outfit-suggestions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const CART_OUTFIT_SEARCH_STATE = {
  search: "",
  sortMode: "recent" as const,
  heartsOnly: false,
  disponiblesOnly: true,
  filters: emptyShopCatalogFilters,
};

function availableOutfitRailItems(items: ShopCatalogItem[], compact: boolean): ShopCatalogItem[] {
  const borrowable = items.filter((item) => item.status === "available" || item.status === "in_cart");
  return compact ? borrowable.slice(0, 4) : borrowable.slice(0, 10);
}

type CartOutfitSuggestionsSectionProps = {
  cartItemIds: string[];
  /** Données SSR pour affichage immédiat ; le client re-fetch pour rester stable après `router.refresh()`. */
  initialItems?: ShopCatalogItem[];
  /** Version plus compacte pour le checkout (max 4 pièces). */
  compact?: boolean;
};

export function CartOutfitSuggestionsSection({
  cartItemIds,
  initialItems = [],
  compact = false,
}: CartOutfitSuggestionsSectionProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const {
    coverUrlById,
    likedSet,
    likeBusyIds,
    cartBusyIds,
    localCartItemIds,
    handleToggleLike,
    handleToggleCart,
  } = useCartShopHubUi();

  const cartItemIdsKey = useMemo(
    () => [...new Set(cartItemIds.map((id) => id.trim()).filter(Boolean))].sort().join(","),
    [cartItemIds],
  );

  const [items, setItems] = useState<ShopCatalogItem[]>(() => availableOutfitRailItems(initialItems, compact));

  const refreshSuggestions = useCallback(async () => {
    const ids = cartItemIdsKey ? cartItemIdsKey.split(",").filter(Boolean) : [];
    if (ids.length === 0) {
      setItems([]);
      return;
    }

    const limit = compact ? 4 : 10;
    const { data, error } = await supabase.rpc("get_cart_outfit_suggestions", {
      p_cart_item_ids: ids,
      p_exclude_item_ids: ids,
      p_limit: limit,
    });

    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.info("[Cart] get_cart_outfit_suggestions:", error.message ?? error);
      }
      return;
    }

    const parsed = availableOutfitRailItems(parseCartOutfitSuggestionsRpcData(data), compact);
    if (parsed.length > 0) {
      setItems(parsed);
      return;
    }
    if (ids.length === 0) {
      setItems([]);
    }
  }, [cartItemIdsKey, compact, supabase]);

  useEffect(() => {
    if (initialItems.length > 0) {
      setItems(availableOutfitRailItems(initialItems, compact));
    }
  }, [compact, initialItems]);

  useEffect(() => {
    void refreshSuggestions();
  }, [refreshSuggestions]);

  useEffect(() => {
    const onCartChanged = () => void refreshSuggestions();
    window.addEventListener("segna:cart-changed", onCartChanged as EventListener);
    return () => window.removeEventListener("segna:cart-changed", onCartChanged as EventListener);
  }, [refreshSuggestions]);

  if (items.length === 0) return null;

  return (
    <div className={cn("bg-white", compact ? "py-3" : "py-4")}>
      <h2
        className={cn(
          "px-5",
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
          items={items}
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
          hideLikeAction
          compactCard
          sectionInsetScroll
        />
      </div>
    </div>
  );
}
