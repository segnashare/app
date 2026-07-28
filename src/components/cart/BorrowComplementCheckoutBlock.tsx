"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { SegnaExchangeCreditPhrase, SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import {
  centsPerMissingCreditForDuration,
  formatEuroPerCredit,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";
import { cn } from "@/lib/utils/cn";

type BorrowComplementCheckoutBlockProps = {
  options: BorrowCheckoutOption[];
  durationDays: number;
  onDurationChange: (durationDays: number) => void;
  cartTotalPoints: number;
  availablePoints: number;
  missingPoints: number;
  /** Panier : prix unitaire sous la durée. Frais facturés : masqué. */
  showDailyPrice?: boolean;
  className?: string;
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

function CalcPointsValue({
  points,
  prefix,
  emphasis = false,
}: {
  points: number;
  prefix?: string;
  emphasis?: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {prefix ? (
        <span
          className={cn(
            "tabular-nums",
            emphasis ? "text-[15px] font-bold text-zinc-950" : "text-[14px] font-medium text-zinc-800",
          )}
          aria-hidden
        >
          {prefix}
        </span>
      ) : null}
      <SegnaPointsUnitDisplay
        points={points}
        creditKind="consumption"
        unitDisplay="icon"
        className="gap-x-1"
        numberClassName={cn(
          emphasis ? "text-[15px] font-bold text-zinc-950" : "text-[14px] font-medium text-zinc-800",
        )}
      />
    </span>
  );
}

function CalcRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 leading-snug">
      <span className={cn("text-[14px]", emphasis ? "font-semibold text-zinc-900" : "text-zinc-500")}>{label}</span>
      <span className="shrink-0">{value}</span>
    </div>
  );
}

export function BorrowComplementCheckoutBlock({
  options,
  durationDays,
  onDurationChange,
  cartTotalPoints,
  availablePoints,
  missingPoints,
  showDailyPrice = true,
  className,
  hideDurationSelector = false,
}: BorrowComplementCheckoutBlockProps) {
  if (options.length === 0) return null;

  const sorted = sortedBorrowOptions(options);
  const idx = optionIndex(sorted, durationDays);
  const canPrev = idx > 0;
  const canNext = idx < sorted.length - 1;
  const durationLabel = compactDurationLabel(durationDays);
  const unitCreditPriceLabel = showDailyPrice
    ? formatEuroPerCredit(centsPerMissingCreditForDuration(options, durationDays))
    : null;

  return (
    <div className={cn("space-y-5", className)} role="status" aria-live="polite">
      <div className="space-y-2.5">
        <CalcRow label="Panier" value={<CalcPointsValue points={cartTotalPoints} />} />
        <CalcRow label="Ton budget" value={<CalcPointsValue points={availablePoints} prefix="−" />} />
        <CalcRow
          label="À compléter (1 mois · 10 %)"
          value={<CalcPointsValue points={missingPoints} emphasis />}
          emphasis
        />
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
          {unitCreditPriceLabel ? (
            <span
              className="inline-flex flex-wrap items-center justify-end gap-2 text-[14px] font-medium tabular-nums text-zinc-700"
              aria-label={`${unitCreditPriceLabel} par crédit`}
            >
              <span className="inline-flex items-center gap-1">
                <span className="font-semibold text-zinc-900">{unitCreditPriceLabel}</span>
                <span className="text-zinc-500" aria-hidden>
                  /
                </span>
                <SegnaExchangeCreditPhrase textClassName="text-zinc-700" />
              </span>
            </span>
          ) : null}
        </div>
      </div>
      )}
    </div>
  );
}
