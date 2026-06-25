"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  SegnaDialogDismissButton,
  SegnaDialogTitleRow,
  segnaDialogBodyClass,
} from "@/components/ui/SegnaAppDialog";
import {
  BORROW_OVERDUE_CG_LOCATION_HREF,
  formatBorrowOverdueBannerBodyLinesFr,
  formatBorrowOverdueHeadlineFr,
  formatBorrowOverdueOrderLinesFr,
} from "@/lib/cart/format-borrow-overdue-copy";
import type { MemberBorrowReturnOverdueAlert } from "@/lib/cart/fetch-member-borrow-return-overdue-alerts";
import {
  dismissBorrowReturnOverdueForToday,
  isBorrowReturnOverdueDismissed,
} from "@/lib/emprunt/borrow-return-overdue-dismiss";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  alerts: MemberBorrowReturnOverdueAlert[];
};

function pickVisibleAlert(alerts: MemberBorrowReturnOverdueAlert[]): MemberBorrowReturnOverdueAlert | null {
  return alerts.find((a) => !isBorrowReturnOverdueDismissed(a.cartId)) ?? null;
}

function CopyLines({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {lines.map((line, i) => (
        <p key={i} className={segnaDialogBodyClass()}>
          {line}
        </p>
      ))}
    </div>
  );
}

/** Bandeau retard en haut de la page Échange (après l’échéance de retour). */
export function BorrowReturnOverdueBanner({ alerts }: Props) {
  /** Pas de lecture localStorage à l’init (SSR ≠ client → hydration). */
  const [visibleAlert, setVisibleAlert] = useState<MemberBorrowReturnOverdueAlert | null>(null);

  useEffect(() => {
    setVisibleAlert(pickVisibleAlert(alerts));
  }, [alerts]);

  const dismiss = useCallback(() => {
    if (!visibleAlert) return;
    dismissBorrowReturnOverdueForToday(visibleAlert.cartId);
    const next = alerts.find(
      (a) => a.cartId !== visibleAlert.cartId && !isBorrowReturnOverdueDismissed(a.cartId),
    );
    setVisibleAlert(next ?? null);
  }, [alerts, visibleAlert]);

  if (!visibleAlert) return null;

  const headline = formatBorrowOverdueHeadlineFr(visibleAlert.lateDayIndex);
  const orderLines = formatBorrowOverdueOrderLinesFr(
    visibleAlert.orderNumberCompact,
    visibleAlert.lateDayIndex,
  );
  const bodyLines = formatBorrowOverdueBannerBodyLinesFr(visibleAlert.lateDayIndex);
  const multiple = alerts.length > 1;

  return (
    <div
      className="w-full rounded-2xl border-2 border-zinc-900 bg-white p-4 shadow-sm"
      role="region"
      aria-labelledby="borrow-return-overdue-title"
    >
      <SegnaDialogTitleRow
        id="borrow-return-overdue-title"
        title={headline}
        right={<SegnaDialogDismissButton variant="inline" onClick={dismiss} aria-label="Fermer" />}
      />
      <CopyLines lines={orderLines} className="mt-2" />
      {multiple ? (
        <p className={cn(segnaDialogBodyClass(), "mt-1")}>{alerts.length} retours en cours.</p>
      ) : null}
      <CopyLines lines={bodyLines} className="mt-2 text-zinc-700" />
      <p className={cn(segnaDialogBodyClass(), "mt-2 text-zinc-700")}>
        <a
          href={BORROW_OVERDUE_CG_LOCATION_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-blue-600 underline decoration-blue-500/40 underline-offset-2"
        >
          Conditions générales de location
        </a>
        .
      </p>
      <div className="segna-urgent-red-shimmer-active mt-4">
        <Link
          href={visibleAlert.retourHref}
          className={cn(
            segnaMontserrat.className,
            "segna-urgent-red-shimmer-target relative flex w-full items-center justify-center rounded-full border border-red-700 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 active:scale-[0.99]",
          )}
        >
          <span className="relative z-[2]">Retourner ma box</span>
        </Link>
      </div>
    </div>
  );
}
