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
    <div className="mt-3 rounded-xl border border-zinc-200/90 bg-zinc-50/80 text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-zinc-900">
            {formatBorrowOverdueAppGateChargeHistoryTitleFr()}
          </span>
          {!open ? (
            <span className="mt-0.5 block truncate text-[12px] font-medium text-zinc-600">{teaser}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")}
          strokeWidth={2.25}
          aria-hidden
        />
      </button>
      {showStripeSettlement && unpaidPenaltyCents > 0 ? (
        <div className="border-t border-zinc-200/80 px-3 py-2.5">
          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
            <p className="text-[12px] font-semibold leading-snug text-zinc-900">
              Total à régler : {formatEuros(unpaidPenaltyCents)}{" "}
              <Link href={regulariserHref} className={cn(segnaInlineActionLinkClass, "text-[12px] font-semibold")}>
                {formatBorrowOverdueAppGateChargeHistorySettleLabelFr()}
              </Link>
            </p>
          </div>
        </div>
      ) : null}
      {open ? (
        <div className="space-y-3 border-t border-zinc-200/80 px-3 pb-3 pt-2">
          {chargeDays.length === 0 ? (
            <p className="text-[12px] font-medium text-zinc-600">Aucun prélèvement enregistré pour l&apos;instant.</p>
          ) : (
            <ul className="space-y-1.5">
              {[...chargeDays].reverse().map((day) => (
                <li
                  key={day.id}
                  className="flex items-baseline justify-between gap-2 text-[12px] leading-snug text-zinc-800"
                >
                  <span className="min-w-0 truncate">
                    J{day.lateDayIndex}
                    {day.calendarDate ? ` · ${formatCalendarDateFr(day.calendarDate)}` : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="font-semibold tabular-nums">{formatEuros(day.penaltyCents)}</span>
                    <span
                      className={cn(
                        "ml-1.5 font-medium",
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
            <p className="text-[12px] font-medium leading-relaxed text-zinc-600">
              {formatBorrowOverdueAppGateChargeHistoryPendingNoteFr()}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
