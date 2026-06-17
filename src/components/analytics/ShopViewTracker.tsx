"use client";

import { useEffect } from "react";

import { trackPageOnce } from "@/lib/analytics/track-page-once";

/** Une fois par onglet : `shop_viewed` (funnel découverte shop → emprunt). */
export function ShopViewTracker(): null {
  useEffect(() => {
    trackPageOnce("shop", "shop_viewed", { source: "shop_page" });
  }, []);

  return null;
}
