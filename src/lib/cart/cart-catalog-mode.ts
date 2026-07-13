import {
  writeCheckoutBorrowDurationDays,
} from "@/lib/cart/checkout-borrow-duration-storage";

/** Mode catalogue / panier : durée location ou achat. */
export type CartCatalogMode = "location_7j" | "location_30j" | "achat";

export const CART_CATALOG_MODE_STORAGE_KEY = "segna:cart-catalog-mode";
export const CART_CATALOG_MODE_CHANGED_EVENT = "segna:cart-catalog-mode-changed";

export const CART_CATALOG_MODES: readonly CartCatalogMode[] = [
  "location_7j",
  "location_30j",
  "achat",
] as const;

export const DEFAULT_CART_CATALOG_MODE: CartCatalogMode = "location_30j";

export function cartCatalogModeLabel(mode: CartCatalogMode): string {
  switch (mode) {
    case "location_7j":
      return "Location 7j";
    case "location_30j":
      return "Location 30j";
    case "achat":
      return "Achat";
  }
}

/** Libellé court toggle catalogue / panier. */
export function cartCatalogModeShortLabel(mode: CartCatalogMode): string {
  switch (mode) {
    case "location_7j":
      return "7j";
    case "location_30j":
      return "30j";
    case "achat":
      return "Achat";
  }
}

/** Libellé fiche produit (segments plus explicites). */
export function cartCatalogModeItemPageLabel(mode: CartCatalogMode): string {
  switch (mode) {
    case "location_7j":
      return "Semaine";
    case "location_30j":
      return "Mois";
    case "achat":
      return "Achat";
  }
}

export function isPurchaseCartCatalogMode(mode: CartCatalogMode): boolean {
  return mode === "achat";
}

export function durationDaysForCartCatalogMode(mode: CartCatalogMode): number | null {
  if (mode === "location_7j") return 7;
  if (mode === "location_30j") return 30;
  return null;
}

export function cartCatalogModeFromDurationDays(durationDays: number): CartCatalogMode {
  if (durationDays === 7) return "location_7j";
  if (durationDays === 30) return "location_30j";
  return DEFAULT_CART_CATALOG_MODE;
}

export function readCartCatalogMode(): CartCatalogMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CART_CATALOG_MODE_STORAGE_KEY);
    if (raw === "location_7j" || raw === "location_30j" || raw === "achat") return raw;
    return null;
  } catch {
    return null;
  }
}

export function resolveCartCatalogMode(stored: CartCatalogMode | null | undefined): CartCatalogMode {
  if (stored && CART_CATALOG_MODES.includes(stored)) return stored;
  const fromDuration = readCheckoutBorrowDurationDaysAsMode();
  return fromDuration ?? DEFAULT_CART_CATALOG_MODE;
}

function readCheckoutBorrowDurationDaysAsMode(): CartCatalogMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("segna:checkout-borrow-duration-days");
    if (!raw) return null;
    const n = Math.trunc(Number(raw));
    if (n === 7) return "location_7j";
    if (n === 30) return "location_30j";
    return null;
  } catch {
    return null;
  }
}

export function writeCartCatalogMode(mode: CartCatalogMode) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CART_CATALOG_MODE_STORAGE_KEY, mode);
  const durationDays = durationDaysForCartCatalogMode(mode);
  if (durationDays != null) writeCheckoutBorrowDurationDays(durationDays);
  window.dispatchEvent(new CustomEvent(CART_CATALOG_MODE_CHANGED_EVENT, { detail: { mode } }));
}
