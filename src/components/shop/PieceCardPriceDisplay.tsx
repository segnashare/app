"use client";

import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { ItemWeeklyRentalPriceDisplay } from "@/components/ui/ItemWeeklyRentalPriceDisplay";
import { useGuestCashRentalCatalog } from "@/components/shop/GuestCashRentalCatalogContext";
import { cn } from "@/lib/utils/cn";

type PieceCardPriceDisplayProps = {
  pricePoints: number | null;
  numberClassName?: string;
  iconColor?: "fixed" | "current";
};

export function PieceCardPriceDisplay({
  pricePoints,
  numberClassName,
  iconColor = "fixed",
}: PieceCardPriceDisplayProps) {
  const guestCashRental = useGuestCashRentalCatalog();

  if (typeof pricePoints !== "number" || Number.isNaN(pricePoints)) {
    return <span className={cn("tabular-nums", numberClassName)}>—</span>;
  }

  if (guestCashRental) {
    return (
      <ItemWeeklyRentalPriceDisplay
        pricePoints={pricePoints}
        priceClassName={cn("text-[11px] font-medium text-zinc-600 min-[380px]:text-[12px]", numberClassName)}
        suffixClassName="text-[10px] min-[380px]:text-[11px]"
      />
    );
  }

  return (
    <SegnaPointsUnitDisplay
      points={pricePoints}
      creditKind="consumption"
      unitDisplay="icon"
      iconColor={iconColor}
      className="shrink-0 gap-x-0.5"
      numberClassName={cn("tabular-nums", numberClassName)}
    />
  );
}
