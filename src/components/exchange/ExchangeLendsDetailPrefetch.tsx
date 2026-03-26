"use client";

import { useEffect } from "react";

import { prefetchLendItemDetailIfNeeded } from "@/lib/items/lend-items-detail-cache";

type Props = {
  /** Tous les ids affichés dans « Prêts » (tous statuts). */
  itemIds: string[];
};

/**
 * Après le rendu de /exchange, précharge en arrière-plan les fiches détail des pièces « prêts »
 * pour que la navigation vers `/items/[id]` réutilise un cache chaud (moins d’écran « Chargement… »).
 */
export function ExchangeLendsDetailPrefetch({ itemIds }: Props) {
  const signature = itemIds.join(",");

  useEffect(() => {
    if (!signature) return;
    const unique = [...new Set(signature.split(",").map((id) => id.trim()).filter(Boolean))];
    void Promise.all(unique.map((id) => prefetchLendItemDetailIfNeeded(id))).catch(() => {
      // silencieux : échec réseau géré au clic sur la fiche
    });
  }, [signature]);

  return null;
}
