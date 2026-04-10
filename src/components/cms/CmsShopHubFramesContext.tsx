"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { ShopCategoryTreeNode } from "@/lib/shop/shop-department-categories";

/**
 * Environnement hub boutique : filtres + rendu riche des frames `shop_*`.
 * Hors hub (panier, profil, échange…), ces callbacks sont absents → repli lien simple identique visuellement.
 */
export type CmsShopHubFramesEnv = {
  categories: ShopCategoryTreeNode[];
  brands: { id: string; label: string }[];
  onCategoryFilter: (id: string) => void;
  onBrandFilter: (id: string) => void;
  renderShopItemRef?: (row: CmsFrameRow) => ReactNode;
  renderShopLinkCard?: (row: CmsFrameRow) => ReactNode;
  /**
   * Panier / profil : rendu riche `shop_item_ref` mais catégorie & marque → liens boutique
   * (pas de filtre in-page avec `categories` / `brands` vides).
   */
  refsPreferShopNavigation?: boolean;
};

const CmsShopHubFramesContext = createContext<CmsShopHubFramesEnv | null>(null);

export function CmsShopHubFramesProvider({
  value,
  children,
}: {
  value: CmsShopHubFramesEnv;
  children: ReactNode;
}) {
  return <CmsShopHubFramesContext.Provider value={value}>{children}</CmsShopHubFramesContext.Provider>;
}

export function useCmsShopHubFramesOptional(): CmsShopHubFramesEnv | null {
  return useContext(CmsShopHubFramesContext);
}
