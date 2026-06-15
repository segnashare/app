"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type PageChromeLoadingContextValue = {
  chromeHidden: boolean;
  setChromeHidden: (hidden: boolean) => void;
};

const PageChromeLoadingContext = createContext<PageChromeLoadingContextValue | null>(null);

export function PageChromeLoadingProvider({ children }: { children: ReactNode }) {
  const [chromeHidden, setChromeHidden] = useState(false);
  const value = useMemo(
    () => ({
      chromeHidden,
      setChromeHidden,
    }),
    [chromeHidden],
  );
  return <PageChromeLoadingContext.Provider value={value}>{children}</PageChromeLoadingContext.Provider>;
}

export function usePageChromeHidden(): boolean {
  return useContext(PageChromeLoadingContext)?.chromeHidden ?? false;
}

/** Masque panier flottant + bulle chat pendant un écran de chargement pleine page. */
export function PageChromeLoadingMarker() {
  const setChromeHidden = useContext(PageChromeLoadingContext)?.setChromeHidden;

  useEffect(() => {
    if (!setChromeHidden) return;
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [setChromeHidden]);

  return null;
}
