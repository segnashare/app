"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  formatBorrowOverdueAppGateChargeHistoryPendingNoteFr,
  formatBorrowOverdueAppGateChargeHistorySettleLabelFr,
  formatBorrowOverdueAppGateChargeHistoryTeaserFr,
  formatBorrowOverdueAppGateChargeHistoryTitleFr,
  formatBorrowOverdueChargeDayStatusFr,
} from "@/lib/cart/format-borrow-overdue-copy";
import type { MemberBorrowOverdueAppGate } from "@/lib/emprunt/fetch-member-borrow-overdue-app-gate";
import { segnaInlineActionLinkClass } from "@/lib/ui/segna-inline-link";
import { cn } from "@/lib/utils/cn";

type Props = Pick<
  MemberBorrowOverdueAppGate,
  | "chargeDays"
  | "chargedPenaltyCents"
  | "unpaidPenaltyCents"
  | "hasFailedCharge"
  | "showStripeSettlement"
  | "regulariserHref"
>;

function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}

function formatCalendarDateFr(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(parsed);
}

export function BorrowOverdueAppGateChargeHistory({
  chargeDays,
  chargedPenaltyCents,
  unpaidPenaltyCents,
  hasFailedCharge,
  showStripeSettlement,
  regulariserHref,
}: Props) {
  const [open, setOpen] = useState(false);
  const teaser = formatBorrowOverdueAppGateChargeHistoryTeaserFr({
    chargedCents: chargedPenaltyCents,
    unpaidCents: unpaidPenaltyCents,
    hasFailedCharge,
    showStripeSettlement,
  });

  return (
    <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left sm:py-2.5"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-zinc-900 sm:text-[13px]">
            {formatBorrowOverdueAppGateChargeHistoryTitleFr()}
          </span>
          {!open ? (
            <span className="mt-0.5 block truncate text-[11px] font-medium text-zinc-600 sm:text-[12px]">
              {teaser}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")}
          strokeWidth={2.25}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-zinc-200/80 px-3 pb-2.5 pt-2 sm:space-y-2.5 sm:pb-3">
          {showStripeSettlement && unpaidPenaltyCents > 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 sm:px-3 sm:py-2.5">
              <p className="text-[11px] font-semibold leading-snug text-zinc-900 sm:text-[12px]">
                Total à régler : {formatEuros(unpaidPenaltyCents)}{" "}
                <Link href={regulariserHref} className={cn(segnaInlineActionLinkClass, "text-[11px] font-semibold sm:text-[12px]")}>
                  {formatBorrowOverdueAppGateChargeHistorySettleLabelFr()}
                </Link>
              </p>
            </div>
          ) : null}
          {chargeDays.length === 0 ? (
            <p className="text-[11px] font-medium text-zinc-600 sm:text-[12px]">
              Aucun prélèvement enregistré pour l&apos;instant.
            </p>
          ) : (
            <ul className="max-h-[7.25rem] space-y-1 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch] sm:max-h-[8.5rem] sm:space-y-1.5">
              {[...chargeDays].reverse().map((day) => (
                <li
                  key={day.id}
                  className="flex items-baseline justify-between gap-2 text-[11px] leading-snug text-zinc-800 sm:text-[12px]"
                >
                  <span className="min-w-0 truncate">
                    J{day.lateDayIndex}
                    {day.calendarDate ? ` · ${formatCalendarDateFr(day.calendarDate)}` : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="font-semibold tabular-nums">{formatEuros(day.penaltyCents)}</span>
                    <span
                      className={cn(
                        "ml-1 font-medium sm:ml-1.5",
                        day.chargeStatus === "charged"
                          ? "text-emerald-700"
                          : day.chargeStatus === "failed"
                            ? "text-red-700"
                            : "text-amber-700",
                      )}
                    >
                      · {formatBorrowOverdueChargeDayStatusFr(day.chargeStatus)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {unpaidPenaltyCents > 0 && !showStripeSettlement ? (
            <p className="text-[11px] font-medium leading-relaxed text-zinc-600 sm:text-[12px]">
              {formatBorrowOverdueAppGateChargeHistoryPendingNoteFr()}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
