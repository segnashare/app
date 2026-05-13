"use client";

import { useEffect } from "react";

import { prefetchLendItemDetailIfNeeded } from "@/lib/items/lend-items-detail-cache";

type Props = {
  /** Petit sous-ensemble eligible au prechargement automatique. */
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
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    const requestIdle =
      window.requestIdleCallback ??
      ((callback: IdleRequestCallback) =>
        window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 900));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;

    const idleHandle = requestIdle(
      () => {
        void (async () => {
          for (const id of unique) {
            if (cancelled || document.visibilityState !== "visible") return;
            await prefetchLendItemDetailIfNeeded(id).catch(() => null);
          }
        })();
      },
      { timeout: 2500 },
    );

    return () => {
      cancelled = true;
      cancelIdle(idleHandle);
    };
  }, [signature]);

  return null;
}
