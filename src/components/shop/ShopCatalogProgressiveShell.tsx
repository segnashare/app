"use client";

import { useEffect, useState } from "react";

import { ShopCatalog } from "@/components/shop/ShopCatalog";
import {
  mergeShopProgressivePayload,
  type ShopPageCatalogPayload,
  type ShopProgressiveChunk,
} from "@/lib/shop/shop-page-progressive-shared";

type ShopCatalogProgressiveShellProps = {
  critical: ShopPageCatalogPayload;
};

async function fetchProgressiveChunk(body: Record<string, unknown>): Promise<ShopProgressiveChunk> {
  const res = await fetch("/api/shop/progressive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`shop_progressive_${res.status}`);
  }
  return (await res.json()) as ShopProgressiveChunk;
}

export function ShopCatalogProgressiveShell({ critical }: ShopCatalogProgressiveShellProps) {
  const [payload, setPayload] = useState(critical);

  useEffect(() => {
    let cancelled = false;
    let current = critical;

    async function loadRemainingSectionsInOrder() {
      const pending = current.boutiqueHubSectionOrder.filter(
        (key) => !current.readyHubSectionKeys.includes(key),
      );

      for (const sectionKey of pending) {
        if (cancelled) return;
        try {
          const chunk = await fetchProgressiveChunk({
            sectionKey,
            existingItemIds: current.initialItems.map((item) => item.id),
            existingCovers: current.initialCoverUrlById,
            loadedSectionKeys: current.readyHubSectionKeys,
          });
          if (cancelled) return;
          current = mergeShopProgressivePayload(current, chunk);
          setPayload(current);
        } catch (err) {
          console.error("[shop] progressive section failed:", sectionKey, err);
          if (!current.readyHubSectionKeys.includes(sectionKey)) {
            current = {
              ...current,
              readyHubSectionKeys: [...current.readyHubSectionKeys, sectionKey],
            };
            setPayload(current);
          }
        }
      }

      if (cancelled) return;

      try {
        const chunk = await fetchProgressiveChunk({
          step: "remainder",
          existingItemIds: current.initialItems.map((item) => item.id),
          existingCovers: current.initialCoverUrlById,
          loadedSectionKeys: current.readyHubSectionKeys,
        });
        if (cancelled) return;
        setPayload(mergeShopProgressivePayload(current, chunk));
      } catch (err) {
        console.error("[shop] progressive remainder failed:", err);
        setPayload({
          ...current,
          readyHubSectionKeys: current.boutiqueHubSectionOrder,
        });
      }
    }

    void loadRemainingSectionsInOrder();

    return () => {
      cancelled = true;
    };
  }, [critical]);

  return (
    <ShopCatalog
      initialItems={payload.initialItems}
      initialLikedItemIds={payload.initialLikedItemIds}
      initialMostLikedItems={payload.initialMostLikedItems}
      initialCoverUrlById={payload.initialCoverUrlById}
      categories={payload.categories}
      sizes={payload.sizes}
      brands={payload.brands}
      colors={payload.colors}
      materials={payload.materials}
      featuredLenders={payload.featuredLenders}
      featuredLenderSectionItemIds={payload.featuredLenderSectionItemIds}
      initialCmsShopFrames={payload.initialCmsShopFrames}
      shopHomeCapsulesSectionDisplay={payload.shopHomeCapsulesSectionDisplay}
      initialShopHubSections={payload.initialShopHubSections}
      boutiqueHubSectionOrder={payload.boutiqueHubSectionOrder}
      guideCartOnboarding={payload.guideCartOnboarding}
      readyHubSectionKeys={payload.readyHubSectionKeys}
    />
  );
}
