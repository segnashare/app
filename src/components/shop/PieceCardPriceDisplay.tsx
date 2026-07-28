"use client";

import { ItemCatalogModePriceDisplay } from "@/components/ui/ItemCatalogModePriceDisplay";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { useOptionalCartCatalogMode } from "@/components/cart/CartCatalogModeContext";
import { useGuestCashRentalCatalog } from "@/components/shop/GuestCashRentalCatalogContext";
import { cn } from "@/lib/utils/cn";

type PieceCardPriceDisplayProps = {
  pricePoints: number | null;
  numberClassName?: string;
  /** Conservé pour compatibilité API cartes CMS (couleur du jeton crédit). */
  iconColor?: "fixed" | "current";
};

/**
 * Guest : tarif location (€ / semaine|mois) ou achat selon le toggle catalogue.
 * Abonné : valeur pièce en € (budget SegnaX), sans « / mois ».
 */
export function PieceCardPriceDisplay({
  pricePoints,
  numberClassName,
}: PieceCardPriceDisplayProps) {
  const guestCashRental = useGuestCashRentalCatalog();
  const catalogMode = useOptionalCartCatalogMode();

  if (typeof pricePoints !== "number" || Number.isNaN(pricePoints)) {
    return <span className={cn("tabular-nums", numberClassName)}>—</span>;
  }

  const priceClassName = cn(
    "text-[11px] font-medium text-inherit min-[380px]:text-[12px]",
    numberClassName,
  );

  if (!guestCashRental) {
    // Achat membre : prix catalogue (réduction SegnaX affichée au panier / checkout).
    if (catalogMode?.isPurchaseMode) {
      return (
        <ItemCatalogModePriceDisplay
          pricePoints={pricePoints}
          forcedMode="achat"
          priceClassName={priceClassName}
        />
      );
    }

    return (
      <SegnaPointsUnitDisplay
        points={pricePoints}
        creditKind="consumption"
        unitDisplay="icon"
        className="gap-x-0.5"
        numberClassName={priceClassName}
      />
    );
  }

  return (
    <ItemCatalogModePriceDisplay
      pricePoints={pricePoints}
      priceClassName={priceClassName}
      suffixClassName="text-[0.92em] text-inherit min-[380px]:text-[11px]"
    />
  );
}
