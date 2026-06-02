"use client";

import Link from "next/link";

import {
  SegnaDialogDismissButton,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { SegnaAppBottomSheet, SegnaDialogSheetHandle } from "@/components/ui/SegnaAppBottomSheet";
import { WalletVisual } from "@/components/exchange/WalletVisual";
import { cn } from "@/lib/utils/cn";

export type WalletPanelStateContent = {
  title: string;
  description: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel: string;
  secondaryCtaHref: string;
};

type WalletPanelProps = {
  open: boolean;
  onClose: () => void;
  availablePoints: number;
  balanceConsumptionPoints: number;
  balanceExchangePoints: number;
  walletStateContent: WalletPanelStateContent;
};

/**
 * Bottom sheet wallet : deux CTA pleine largeur — secondaire blanc bord noir, principal noir.
 */
export function WalletPanel({
  open,
  onClose,
  availablePoints,
  balanceConsumptionPoints,
  balanceExchangePoints,
  walletStateContent,
}: WalletPanelProps) {
  return (
    <SegnaAppBottomSheet open={open} onClose={onClose} labelledBy="wallet-panel-title">
      <SegnaDialogDismissButton onClick={onClose} className="right-3 top-3" />
      <SegnaDialogSheetHandle />

      <h2 id="wallet-panel-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
        {walletStateContent.title}
      </h2>

      <div className="mt-5 space-y-4">
        <WalletVisual
          open={open}
          availablePoints={availablePoints}
          balanceConsumptionPoints={balanceConsumptionPoints}
          balanceExchangePoints={balanceExchangePoints}
        />

        <div className="flex flex-col gap-2">
          <Link
            href={walletStateContent.secondaryCtaHref}
            onClick={onClose}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border-2 border-zinc-950 bg-white px-3 text-center text-[15px] font-semibold text-zinc-950 transition active:bg-zinc-50"
          >
            {walletStateContent.secondaryCtaLabel}
          </Link>
          <Link
            href={walletStateContent.primaryCtaHref}
            onClick={onClose}
            className="segna-guidance-shimmer-active segna-guidance-shimmer-target inline-flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 px-3 text-center text-[15px] font-semibold text-white shadow-sm transition active:bg-zinc-800"
          >
            {walletStateContent.primaryCtaLabel}
          </Link>
        </div>
      </div>
    </SegnaAppBottomSheet>
  );
}
