"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  centsPerMissingCreditForDuration,
  formatEuroPerCredit,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";
import {
  computeGuestCartPurchaseEuroCents,
  computeGuestCartRentalEuroCents,
  guestRentalPercentOfRetail,
} from "@/lib/billing/guest-rental-pricing";
import { cn } from "@/lib/utils/cn";

type GuestRentalCheckoutBlockProps = {
  options: BorrowCheckoutOption[];
  durationDays: number;
  onDurationChange: (durationDays: number) => void;
  cartTotalPoints: number;
  className?: string;
  /** Durée pilotée par le toggle panier (masque les chevrons). */
  hideDurationSelector?: boolean;
};

function optionIndex(options: ReadonlyArray<BorrowCheckoutOption>, durationDays: number): number {
  const idx = options.findIndex((o) => o.durationDays === durationDays);
  return idx >= 0 ? idx : 0;
}

function sortedBorrowOptions(options: ReadonlyArray<BorrowCheckoutOption>): BorrowCheckoutOption[] {
  return [...options].sort((a, b) => a.sortOrder - b.sortOrder || a.durationDays - b.durationDays);
}

function compactDurationLabel(durationDays: number): string {
  return `${durationDays}j`;
}

function guestRentalLineTitle(durationDays: number): string {
  return `Location ${durationDays} jours`;
}

function eurosFromCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function GuestRentalCheckoutBlock({
  options,
  durationDays,
  onDurationChange,
  cartTotalPoints,
  className,
  hideDurationSelector = false,
}: GuestRentalCheckoutBlockProps) {
  if (options.length === 0) return null;

  const sorted = sortedBorrowOptions(options);
  const idx = optionIndex(sorted, durationDays);
  const canPrev = idx > 0;
  const canNext = idx < sorted.length - 1;
  const durationLabel = compactDurationLabel(durationDays);
  const rentalLineTitle = guestRentalLineTitle(durationDays);
  const retailEuroCents = computeGuestCartPurchaseEuroCents(cartTotalPoints);
  const rentalEuroCents = computeGuestCartRentalEuroCents(cartTotalPoints, durationDays, options);
  const rentalPercent = guestRentalPercentOfRetail(durationDays, options);
  const unitCreditPriceLabel = formatEuroPerCredit(centsPerMissingCreditForDuration(options, durationDays));

  return (
    <div className={cn("space-y-5", className)} role="status" aria-live="polite">
      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-4 leading-snug">
          <span className="text-[13px] font-medium text-zinc-500">Prix d&apos;achat</span>
          <span className="text-[13px] font-medium tabular-nums text-zinc-500">{eurosFromCents(retailEuroCents)}</span>
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-4 leading-snug">
            <span className="text-[15px] font-bold text-zinc-950">{rentalLineTitle}</span>
            <span className="text-[15px] font-bold tabular-nums text-zinc-950">{eurosFromCents(rentalEuroCents)}</span>
          </div>
          <p className="mt-0.5 text-[13px] font-medium italic text-zinc-500">
            {rentalPercent}&nbsp;% du prix d&apos;achat
          </p>
        </div>
      </div>

      {hideDurationSelector ? null : (
        <div className="flex items-start justify-between gap-3 border-t border-zinc-200 pt-5">
          <span className="pt-1.5 text-[15px] font-semibold text-zinc-900">Durée</span>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => canPrev && onDurationChange(sorted[idx - 1]!.durationDays)}
                disabled={!canPrev}
                aria-label="Durée plus courte"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-25"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
              </button>
              <span className="min-w-[3.25rem] text-center text-[20px] font-bold tabular-nums tracking-tight text-zinc-950">
                {durationLabel}
              </span>
              <button
                type="button"
                onClick={() => canNext && onDurationChange(sorted[idx + 1]!.durationDays)}
                disabled={!canNext}
                aria-label="Durée plus longue"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-25"
              >
                <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            <span
              className="text-[14px] font-medium tabular-nums text-zinc-700"
              aria-label={`${unitCreditPriceLabel} par crédit`}
            >
              {unitCreditPriceLabel} / crédit
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
