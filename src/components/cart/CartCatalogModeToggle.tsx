"use client";

import {
  CART_CATALOG_MODES,
  cartCatalogModeItemPageLabel,
  cartCatalogModeLabel,
  cartCatalogModeShortLabel,
  type CartCatalogMode,
} from "@/lib/cart/cart-catalog-mode";
import { useCartCatalogMode } from "@/components/cart/CartCatalogModeContext";
import { cn } from "@/lib/utils/cn";

type CartCatalogModeToggleProps = {
  className?: string;
  /** Panier : segments légèrement plus compacts. Fiche produit : libellés Semaine / Mois / Achat. */
  variant?: "default" | "compact" | "item";
};

export function CartCatalogModeToggle({ className, variant = "default" }: CartCatalogModeToggleProps) {
  const { mode, setMode } = useCartCatalogMode();

  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-white p-1",
        variant === "compact" && "gap-0.5 p-0.5",
        variant === "item" && "gap-0 overflow-hidden rounded-full border border-zinc-200 bg-white p-0",
        className,
      )}
      role="tablist"
      aria-label={variant === "item" ? "Type de tarif" : "Mode panier"}
    >
      {CART_CATALOG_MODES.map((option, index) => (
        <ModeSegment
          key={option}
          option={option}
          active={mode === option}
          onSelect={setMode}
          variant={variant}
          segmentIndex={index}
          segmentCount={CART_CATALOG_MODES.length}
        />
      ))}
    </div>
  );
}

function ModeSegment({
  option,
  active,
  onSelect,
  variant,
  segmentIndex,
  segmentCount,
}: {
  option: CartCatalogMode;
  active: boolean;
  onSelect: (mode: CartCatalogMode) => void;
  variant: "default" | "compact" | "item";
  segmentIndex: number;
  segmentCount: number;
}) {
  const label =
    variant === "item"
      ? cartCatalogModeItemPageLabel(option)
      : cartCatalogModeShortLabel(option);

  const isFirst = segmentIndex === 0;
  const isLast = segmentIndex === segmentCount - 1;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={cartCatalogModeLabel(option)}
      onClick={() => onSelect(option)}
      className={cn(
        "inline-flex items-center justify-center border border-transparent text-center font-semibold transition-colors duration-200",
        variant === "compact"
          ? "min-h-9 rounded-lg px-2 text-[13px] leading-none"
          : variant === "item"
            ? "px-4 py-2.5 text-[11px] leading-none tracking-wide"
            : "min-h-10 rounded-lg px-2.5 text-[14px] leading-none",
        variant === "item" && isFirst && "rounded-l-full",
        variant === "item" && isLast && "rounded-r-full",
        active
          ? "bg-zinc-900 text-white shadow-sm"
          : "bg-transparent text-zinc-800 hover:bg-zinc-50",
      )}
    >
      {label}
    </button>
  );
}
