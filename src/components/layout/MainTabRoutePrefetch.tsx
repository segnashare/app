"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { MAIN_TABS } from "@/components/layout/navigation";

/**
 * Précharge les routes des onglets principaux en idle pour réduire l’attente au tap.
 */
export function MainTabRoutePrefetch() {
  const router = useRouter();

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    const prefetchTabs = () => {
      if (cancelled) return;
      for (const tab of MAIN_TABS) {
        router.prefetch(tab.href);
      }
    };

    const requestIdle =
      window.requestIdleCallback ??
      ((callback: IdleRequestCallback) =>
        window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 500));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;

    const idleHandle = requestIdle(prefetchTabs, { timeout: 1800 });

    return () => {
      cancelled = true;
      cancelIdle(idleHandle);
    };
  }, [router]);

  return null;
}
