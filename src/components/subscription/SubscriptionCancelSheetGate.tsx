"use client";

import { useCallback, useEffect, useState } from "react";

import { SegnaAppBottomSheet, SegnaDialogSheetHandle } from "@/components/ui/SegnaAppBottomSheet";
import {
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { formatLongDateParis } from "@/lib/datetime/segna-datetime";
import {
  clearSubscriptionCancelPending,
  isSubscriptionCancelPending,
  readSubscriptionCancelPeriodEnd,
} from "@/lib/subscription/subscription-cancel-storage";
import { cn } from "@/lib/utils/cn";

type Props = {
  periodEndFromServer?: string | null;
};

/**
 * Exchange : bottom sheet après résiliation (fin de période).
 */
export function SubscriptionCancelSheetGate({ periodEndFromServer = null }: Props) {
  const [open, setOpen] = useState(false);
  const [periodEnd, setPeriodEnd] = useState<string | null>(periodEndFromServer);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("subscription") === "canceled") {
          params.delete("subscription");
          const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
          window.history.replaceState({}, "", next);
        }
      } catch {
        /* ignore */
      }
    }
    if (!isSubscriptionCancelPending()) return;
    setPeriodEnd(readSubscriptionCancelPeriodEnd() ?? periodEndFromServer);
    setOpen(true);
  }, [periodEndFromServer]);

  const dismiss = useCallback(() => {
    clearSubscriptionCancelPending();
    setOpen(false);
  }, []);

  const dateLabel = periodEnd ? formatLongDateParis(periodEnd) : "la fin de ta période en cours";

  return (
    <SegnaAppBottomSheet open={open} onClose={dismiss} labelledBy="subscription-cancel-title" zIndexClassName="z-[220]">
      <SegnaDialogSheetHandle />
      <h2 id="subscription-cancel-title" className={cn(segnaDialogTitleClass(), "text-left text-[26px] leading-tight")}>
        Abonnement résilié
      </h2>
      <p className={cn(segnaDialogBodyClass(), "mt-3 text-left")}>
        Tu gardes tes crédits et avantages jusqu’au <strong>{dateLabel}</strong>.
      </p>
      <p className={cn(segnaDialogBodyClass(), "mt-3 text-left")}>
        Renvoie tes locations avant ce jour — c’est le dernier jour de location. Ensuite ton compte
        repasse en Guest.
      </p>
      <div className={cn(segnaDialogMontserrat.className, "mt-7")}>
        <button
          type="button"
          onClick={dismiss}
          className="w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800"
        >
          Compris
        </button>
      </div>
    </SegnaAppBottomSheet>
  );
}
