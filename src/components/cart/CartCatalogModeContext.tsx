"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  CART_CATALOG_MODE_CHANGED_EVENT,
  DEFAULT_CART_CATALOG_MODE,
  durationDaysForCartCatalogMode,
  isPurchaseCartCatalogMode,
  readCartCatalogMode,
  resolveCartCatalogMode,
  type CartCatalogMode,
  writeCartCatalogMode,
} from "@/lib/cart/cart-catalog-mode";

type CartCatalogModeContextValue = {
  mode: CartCatalogMode;
  setMode: (mode: CartCatalogMode) => void;
  durationDays: number | null;
  isPurchaseMode: boolean;
};

const CartCatalogModeContext = createContext<CartCatalogModeContextValue | null>(null);

export function CartCatalogModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<CartCatalogMode>(DEFAULT_CART_CATALOG_MODE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setModeState(resolveCartCatalogMode(readCartCatalogMode()));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const onExternalChange = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: CartCatalogMode }>).detail;
      if (detail?.mode) {
        setModeState(detail.mode);
        return;
      }
      setModeState(resolveCartCatalogMode(readCartCatalogMode()));
    };
    window.addEventListener(CART_CATALOG_MODE_CHANGED_EVENT, onExternalChange);
    return () => window.removeEventListener(CART_CATALOG_MODE_CHANGED_EVENT, onExternalChange);
  }, [hydrated]);

  const setMode = useCallback((next: CartCatalogMode) => {
    writeCartCatalogMode(next);
    setModeState(next);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      durationDays: durationDaysForCartCatalogMode(mode),
      isPurchaseMode: isPurchaseCartCatalogMode(mode),
    }),
    [mode, setMode],
  );

  return <CartCatalogModeContext.Provider value={value}>{children}</CartCatalogModeContext.Provider>;
}

export function useCartCatalogMode(): CartCatalogModeContextValue {
  const ctx = useContext(CartCatalogModeContext);
  if (!ctx) {
    throw new Error("useCartCatalogMode must be used within CartCatalogModeProvider");
  }
  return ctx;
}

/** Lecture seule hors provider (ex. composant optionnel). */
export function useOptionalCartCatalogMode(): CartCatalogModeContextValue | null {
  return useContext(CartCatalogModeContext);
}
