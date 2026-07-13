"use client";

import { ItemCatalogModePriceDisplay } from "@/components/ui/ItemCatalogModePriceDisplay";
import { ItemWeeklyRentalPriceDisplay } from "@/components/ui/ItemWeeklyRentalPriceDisplay";
import { useOptionalCartCatalogMode } from "@/components/cart/CartCatalogModeContext";
import { cn } from "@/lib/utils/cn";

type PieceCardPriceDisplayProps = {
  pricePoints: number | null;
  numberClassName?: string;
  /** Conservé pour compatibilité API cartes CMS (couleur du jeton crédit). */
  iconColor?: "fixed" | "current";
};

export function PieceCardPriceDisplay({
  pricePoints,
  numberClassName,
}: PieceCardPriceDisplayProps) {
  const catalogMode = useOptionalCartCatalogMode();

  if (typeof pricePoints !== "number" || Number.isNaN(pricePoints)) {
    return <span className={cn("tabular-nums", numberClassName)}>—</span>;
  }

  const PriceDisplay = catalogMode ? ItemCatalogModePriceDisplay : ItemWeeklyRentalPriceDisplay;

  return (
    <PriceDisplay
      pricePoints={pricePoints}
      priceClassName={cn(
        "text-[11px] font-medium text-inherit min-[380px]:text-[12px]",
        numberClassName,
      )}
      suffixClassName="text-[0.92em] text-inherit min-[380px]:text-[11px]"
    />
  );
}
