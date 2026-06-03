"use client";

import { ChevronLeft, ChevronRight, Info } from "lucide-react";

import type { BorrowCheckoutOption } from "@/lib/billing/fetch-borrow-checkout-options";
import { cn } from "@/lib/utils/cn";

type BorrowDurationStepperProps = {
  options: BorrowCheckoutOption[];
  value: number;
  onChange: (durationDays: number) => void;
  className?: string;
};

type BorrowComplementRowProps = {
  options: BorrowCheckoutOption[];
  value: number;
  onChange: (durationDays: number) => void;
  priceLabel: string;
  onInfoClick?: () => void;
  className?: string;
};

function optionIndex(options: ReadonlyArray<BorrowCheckoutOption>, durationDays: number): number {
  const idx = options.findIndex((o) => o.durationDays === durationDays);
  return idx >= 0 ? idx : 0;
}

function compactBorrowDurationLabel(durationDays: number): string {
  return `${durationDays}j`;
}

function sortedBorrowOptions(options: ReadonlyArray<BorrowCheckoutOption>): BorrowCheckoutOption[] {
  return [...options].sort((a, b) => a.sortOrder - b.sortOrder || a.durationDays - b.durationDays);
}

export function BorrowComplementRow({
  options,
  value,
  onChange,
  priceLabel,
  onInfoClick,
  className,
}: BorrowComplementRowProps) {
  if (options.length === 0) return null;

  const sorted = sortedBorrowOptions(options);
  const idx = optionIndex(sorted, value);
  const current = sorted[idx] ?? sorted[0];
  const canPrev = idx > 0;
  const canNext = idx < sorted.length - 1;

  const goPrev = () => {
    if (!canPrev) return;
    onChange(sorted[idx - 1]!.durationDays);
  };

  const goNext = () => {
    if (!canNext) return;
    onChange(sorted[idx + 1]!.durationDays);
  };

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      role="status"
      aria-live="polite"
      aria-label={`Complément d'emprunt, ${compactBorrowDurationLabel(current.durationDays)}, ${priceLabel}`}
    >
      <div className="flex min-w-0 shrink items-center gap-0.5">
        <span className="text-[15px] font-semibold leading-tight text-zinc-900">Complément d&apos;emprunt</span>
        {onInfoClick ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label="Informations sur le complément d'emprunt"
            onClick={onInfoClick}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100"
          >
            <Info className="h-4 w-4" strokeWidth={2.2} />
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
        <button
          type="button"
          onClick={goPrev}
          disabled={!canPrev}
          aria-label="Durée précédente"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.25} />
        </button>
        <span className="min-w-[2.25rem] text-center text-[15px] font-semibold tabular-nums text-zinc-900">
          {compactBorrowDurationLabel(current.durationDays)}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={!canNext}
          aria-label="Durée suivante"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" strokeWidth={2.25} />
        </button>
      </div>

      <span className="shrink-0 text-[15px] font-semibold tabular-nums text-red-600">{priceLabel}</span>
    </div>
  );
}

export function BorrowDurationStepper({ options, value, onChange, className }: BorrowDurationStepperProps) {
  return (
    <BorrowComplementRow
      options={options}
      value={value}
      onChange={onChange}
      priceLabel=""
      className={className}
    />
  );
}

/** @deprecated Utiliser BorrowComplementRow */
export const BorrowDurationSelector = BorrowComplementRow;
