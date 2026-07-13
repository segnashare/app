"use client";

import { CartCatalogModeToggle } from "@/components/cart/CartCatalogModeToggle";
import { useCartCatalogMode } from "@/components/cart/CartCatalogModeContext";
import {
  computeItemPurchaseEuroCents,
  computeItemWeeklyRentalEuroCents,
  guestRentalPercentOfRetail,
} from "@/lib/billing/guest-rental-pricing";
import {
  BORROW_CHECKOUT_OPTIONS_FALLBACK,
  computeItemRentalEuroCents,
  formatEuroPerCredit,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type ItemGuestPriceSelectorProps = {
  pricePoints: number | null | undefined;
  borrowCheckoutOptions?: ReadonlyArray<BorrowCheckoutOption>;
  className?: string;
};

export function ItemGuestPriceSelector({
  pricePoints,
  borrowCheckoutOptions = BORROW_CHECKOUT_OPTIONS_FALLBACK,
  className,
}: ItemGuestPriceSelectorProps) {
  const { mode, isPurchaseMode } = useCartCatalogMode();

  const priceDisplay = (() => {
    if (typeof pricePoints !== "number" || Number.isNaN(pricePoints)) return null;
    if (isPurchaseMode) {
      return {
        main: formatEuroPerCredit(computeItemPurchaseEuroCents(pricePoints)),
        suffix: null as string | null,
        percent: null as number | null,
      };
    }

    const durationDays = mode === "location_30j" ? 30 : 7;
    const suffix = mode === "location_30j" ? "mois" : "semaine";
    const cents =
      mode === "location_30j"
        ? computeItemRentalEuroCents(pricePoints, 30, borrowCheckoutOptions)
        : computeItemWeeklyRentalEuroCents(pricePoints, borrowCheckoutOptions);

    return {
      main: formatEuroPerCredit(cents),
      suffix,
      percent: guestRentalPercentOfRetail(durationDays, borrowCheckoutOptions),
    };
  })();

  return (
    <div className={cn(className)}>
      <div className={cn(montserrat.className, "min-w-0")}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-x-3">
          <div className="min-w-0">
            {priceDisplay ? (
              <p className="text-[22px] font-bold leading-none tabular-nums text-zinc-900">{priceDisplay.main}</p>
            ) : (
              <p className="text-[22px] font-bold leading-none text-zinc-900">En cours d&apos;évaluation</p>
            )}
            {priceDisplay?.suffix ? (
              <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">
                <span className="italic">/{priceDisplay.suffix}</span>{" "}
                <span>({priceDisplay.percent}&nbsp;% prix)</span>
              </p>
            ) : null}
          </div>
          <CartCatalogModeToggle variant="item" className="w-full shrink-0 self-center" />
        </div>
      </div>
    </div>
  );
}
