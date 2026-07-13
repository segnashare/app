"use client";

import { useOptionalCartCatalogMode } from "@/components/cart/CartCatalogModeContext";
import type { CartCatalogMode } from "@/lib/cart/cart-catalog-mode";
import {
  BORROW_CHECKOUT_OPTIONS_FALLBACK,
  computeItemRentalEuroCents,
  formatEuroPerCredit,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";
import {
  computeItemPurchaseEuroCents,
  computeItemWeeklyRentalEuroCents,
} from "@/lib/billing/guest-rental-pricing";
import { cn } from "@/lib/utils/cn";

type ItemCatalogModePriceDisplayProps = {
  pricePoints: number | null | undefined;
  borrowCheckoutOptions?: ReadonlyArray<BorrowCheckoutOption>;
  /** Force le mode catalogue (ex. page commande achat sans provider session). */
  forcedMode?: CartCatalogMode;
  className?: string;
  priceClassName?: string;
  suffixClassName?: string;
};

export function ItemCatalogModePriceDisplay({
  pricePoints,
  borrowCheckoutOptions = BORROW_CHECKOUT_OPTIONS_FALLBACK,
  forcedMode,
  className,
  priceClassName,
  suffixClassName,
}: ItemCatalogModePriceDisplayProps) {
  const catalogMode = useOptionalCartCatalogMode();

  if (typeof pricePoints !== "number" || Number.isNaN(pricePoints)) {
    return <span className={cn("tabular-nums", className, priceClassName)}>—</span>;
  }

  const mode = forcedMode ?? catalogMode?.mode ?? "location_7j";

  if (mode === "achat") {
    const cents = computeItemPurchaseEuroCents(pricePoints);
    return (
      <span className={cn("inline-flex shrink-0 tabular-nums", className)}>
        <span className={cn("font-medium", priceClassName ?? "text-zinc-950")}>
          {formatEuroPerCredit(cents)}
        </span>
      </span>
    );
  }

  if (mode === "location_30j") {
    const cents = computeItemRentalEuroCents(pricePoints, 30, borrowCheckoutOptions);
    return (
      <CatalogRentalPriceLine
        cents={cents}
        suffix="mois"
        className={className}
        priceClassName={priceClassName}
        suffixClassName={suffixClassName}
      />
    );
  }

  const cents = computeItemWeeklyRentalEuroCents(pricePoints, borrowCheckoutOptions);
  return (
    <CatalogRentalPriceLine
      cents={cents}
      suffix="semaine"
      className={className}
      priceClassName={priceClassName}
      suffixClassName={suffixClassName}
    />
  );
}

function CatalogRentalPriceLine({
  cents,
  suffix,
  className,
  priceClassName,
  suffixClassName,
}: {
  cents: number;
  suffix: "semaine" | "mois";
  className?: string;
  priceClassName?: string;
  suffixClassName?: string;
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-baseline gap-x-0.5 tabular-nums", className)}>
      <span className={cn("font-medium", priceClassName ?? "text-zinc-950")}>{formatEuroPerCredit(cents)}</span>
      <span className={cn("text-[0.92em] font-normal", suffixClassName ?? "text-zinc-600")}>
        / <span className="italic">{suffix}</span>
      </span>
    </span>
  );
}
