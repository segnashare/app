"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  SegnaDialogDismissButton,
  SegnaDialogTitleRow,
  segnaDialogBodyClass,
} from "@/components/ui/SegnaAppDialog";
import { formatBorrowReturnDueDateFr } from "@/lib/cart/cart-borrow-return-due";
import type { MemberBorrowReturnJjAlert } from "@/lib/cart/fetch-member-borrow-return-jj-alerts";
import {
  dismissBorrowReturnJjForToday,
  isBorrowReturnJjDismissed,
} from "@/lib/emprunt/borrow-return-jj-dismiss";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type Props = {
  alerts: MemberBorrowReturnJjAlert[];
};

function pickVisibleAlert(alerts: MemberBorrowReturnJjAlert[]): MemberBorrowReturnJjAlert | null {
  return alerts.find((a) => !isBorrowReturnJjDismissed(a.cartId)) ?? null;
}

/** Bandeau J-J en haut de la page Échange (échéance retour aujourd’hui). */
export function BorrowReturnJjDayBanner({ alerts }: Props) {
  /** Pas de lecture localStorage à l’init (SSR ≠ client → hydration). */
  const [visibleAlert, setVisibleAlert] = useState<MemberBorrowReturnJjAlert | null>(null);

  useEffect(() => {
    setVisibleAlert(pickVisibleAlert(alerts));
  }, [alerts]);

  const dismiss = useCallback(() => {
    if (!visibleAlert) return;
    dismissBorrowReturnJjForToday(visibleAlert.cartId);
    const next = alerts.find(
      (a) => a.cartId !== visibleAlert.cartId && !isBorrowReturnJjDismissed(a.cartId),
    );
    setVisibleAlert(next ?? null);
  }, [alerts, visibleAlert]);

  if (!visibleAlert) return null;

  const dueLabel = formatBorrowReturnDueDateFr(Date.parse(visibleAlert.dueAtIso));
  const multiple = alerts.length > 1;

  return (
    <div
      className="w-full rounded-2xl border-2 border-zinc-900 bg-white p-4 shadow-sm"
      role="region"
      aria-labelledby="borrow-return-jj-title"
    >
      <SegnaDialogTitleRow
        id="borrow-return-jj-title"
        title="C'est le dernier jour pour retourner ta box"
        right={<SegnaDialogDismissButton variant="inline" onClick={dismiss} aria-label="Fermer" />}
      />
      <p className={cn(segnaDialogBodyClass(), "mt-2")}>
        Échéance pour la commande{" "}
        <strong className="font-semibold text-zinc-900">{visibleAlert.orderNumberCompact}</strong> :{" "}
        <strong className="font-semibold text-zinc-900">{dueLabel}</strong>.
        {multiple ? ` (${alerts.length} retours en cours)` : null}
      </p>
      <p className={cn(segnaDialogBodyClass(), "mt-2 text-zinc-700")}>
        Si tu dépasses la date limite sans avoir déposé ton colis au relais, ton échange passe en{" "}
        <strong className="font-semibold text-zinc-900">retard</strong> : des{" "}
        <strong className="font-semibold text-zinc-900">pénalités</strong> ou mesures prévues aux{" "}
        <a
          href="https://www.segnashare.com/conditions-location"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-blue-600 underline decoration-blue-500/40 underline-offset-2"
        >
          conditions générales de location
        </a>{" "}
        peuvent s&apos;appliquer.
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
