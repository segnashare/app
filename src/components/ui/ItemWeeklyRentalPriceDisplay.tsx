import { cn } from "@/lib/utils/cn";
import {
  BORROW_CHECKOUT_OPTIONS_FALLBACK,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";
import { formatWeeklyRentalPrice } from "@/lib/billing/guest-rental-pricing";

type ItemWeeklyRentalPriceDisplayProps = {
  pricePoints: number | null | undefined;
  borrowCheckoutOptions?: ReadonlyArray<BorrowCheckoutOption>;
  className?: string;
  priceClassName?: string;
  suffixClassName?: string;
};

export function ItemWeeklyRentalPriceDisplay({
  pricePoints,
  borrowCheckoutOptions = BORROW_CHECKOUT_OPTIONS_FALLBACK,
  className,
  priceClassName,
  suffixClassName,
}: ItemWeeklyRentalPriceDisplayProps) {
  if (typeof pricePoints !== "number" || Number.isNaN(pricePoints)) {
    return <span className={cn("tabular-nums", className, priceClassName)}>—</span>;
  }

  const formatted = formatWeeklyRentalPrice(pricePoints, borrowCheckoutOptions);
  const slashIdx = formatted.indexOf(" / ");
  const pricePart = slashIdx >= 0 ? formatted.slice(0, slashIdx) : formatted;
  const suffixPart = slashIdx >= 0 ? formatted.slice(slashIdx + 3) : null;

  return (
    <span className={cn("inline-flex shrink-0 items-baseline gap-x-0.5 tabular-nums", className)}>
      <span className={cn("font-medium", priceClassName ?? "text-zinc-950")}>{pricePart}</span>
      {suffixPart ? (
        <span className={cn("text-[0.92em] font-normal", suffixClassName ?? "text-zinc-600")}>
          / <span className="italic">{suffixPart}</span>
        </span>
      ) : null}
    </span>
  );
}
