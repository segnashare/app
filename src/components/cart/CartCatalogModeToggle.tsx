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

const MEMBER_CART_CATALOG_MODES: readonly CartCatalogMode[] = ["location_30j", "achat"] as const;

type CartCatalogModeToggleProps = {
  className?: string;
  /** Panier : segments légèrement plus compacts. Fiche produit : libellés Semaine / Mois / Achat. */
  variant?: "default" | "compact" | "item";
  /**
   * Abonné : toggle 2 options Location / Achat (pas de 7j).
   * Guest : 7j / 30j / Achat.
   */
  memberSimplified?: boolean;
};

export function CartCatalogModeToggle({
  className,
  variant = "default",
  memberSimplified = false,
}: CartCatalogModeToggleProps) {
  const { mode, setMode } = useCartCatalogMode();
  const options = memberSimplified ? MEMBER_CART_CATALOG_MODES : CART_CATALOG_MODES;

  return (
    <div
      className={cn(
        memberSimplified ? "grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-white p-1" : "grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-white p-1",
        variant === "compact" && "gap-0.5 p-0.5",
        variant === "item" && "gap-0 overflow-hidden rounded-full border border-zinc-200 bg-white p-0",
        className,
      )}
      role="tablist"
      aria-label={variant === "item" ? "Type de tarif" : "Mode panier"}
    >
      {options.map((option, index) => (
        <ModeSegment
          key={option}
          option={option}
          active={mode === option || (memberSimplified && option === "location_30j" && mode === "location_7j")}
          onSelect={(next) => {
            if (memberSimplified && next === "location_30j" && mode === "location_7j") {
              setMode("location_30j");
              return;
            }
            setMode(next);
          }}
          variant={variant}
          memberSimplified={memberSimplified}
          segmentIndex={index}
          segmentCount={options.length}
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
  memberSimplified = false,
  segmentIndex,
  segmentCount,
}: {
  option: CartCatalogMode;
  active: boolean;
  onSelect: (mode: CartCatalogMode) => void;
  variant: "default" | "compact" | "item";
  memberSimplified?: boolean;
  segmentIndex: number;
  segmentCount: number;
}) {
  const label = memberSimplified
    ? option === "achat"
      ? "Achat"
      : "Location"
    : variant === "item"
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
