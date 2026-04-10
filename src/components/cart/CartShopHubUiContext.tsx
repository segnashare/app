"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";

export type CartShopHubUiValue = {
  coverUrlById: Record<string, string>;
  likedSet: Set<string>;
  likeBusyIds: Set<string>;
  cartBusyIds: Set<string>;
  localCartItemIds: Set<string>;
  handleToggleLike: (itemId: string) => Promise<void>;
  handleToggleCart: (itemId: string) => Promise<void>;
  itemById: Map<string, ShopCatalogItem>;
};

const CartShopHubUiContext = createContext<CartShopHubUiValue | null>(null);

export function CartShopHubUiProvider({
  value,
  children,
}: {
  value: CartShopHubUiValue;
  children: ReactNode;
}) {
  return <CartShopHubUiContext.Provider value={value}>{children}</CartShopHubUiContext.Provider>;
}

/** Présent dès que `CartCmsShopHubProvider` enveloppe l’écran panier (même catalogue vide). */
export function useCartShopHubUi(): CartShopHubUiValue {
  const v = useContext(CartShopHubUiContext);
  if (!v) {
    throw new Error("useCartShopHubUi doit être utilisé sous CartCmsShopHubProvider");
  }
  return v;
}

/** Pour composants optionnels (ex. rail « pour vous ») sans crasher si contexte absent. */
export function useCartShopHubUiOptional(): CartShopHubUiValue | null {
  return useContext(CartShopHubUiContext);
}
