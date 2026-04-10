"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
  SEGNA_DIALOG_SHEET_CLASS,
} from "@/components/ui/SegnaAppDialog";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
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
  membershipLabel: "Guest" | "Membre +" | "Membre X";
  walletCreditKind: WalletCreditKind;
  walletStateContent: WalletPanelStateContent;
};

/**
 * Bottom sheet (poignée, titre Montserrat, séparateur) : deux CTA pleine largeur — secondaire blanc bord noir, principal noir.
 */
export function WalletPanel({
  open,
  onClose,
  availablePoints,
  balanceConsumptionPoints,
  balanceExchangePoints,
  membershipLabel,
  walletCreditKind,
  walletStateContent,
}: WalletPanelProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const showDualBalances = membershipLabel !== "Guest";

  const overlay = (
    <div
      className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/40"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-panel-title"
        className={cn(SEGNA_DIALOG_SHEET_CLASS, "relative")}
        onClick={(event) => event.stopPropagation()}
      >
        <SegnaDialogDismissButton onClick={onClose} className="right-3 top-3" />
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />

        <h2 id="wallet-panel-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
          {walletStateContent.title}
        </h2>

        <div className="mt-5 space-y-4">
          {showDualBalances ? (
            <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 text-[14px] font-semibold text-zinc-900">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 shrink text-zinc-600">Crédits d&apos;échange</span>
                <span className="shrink-0 tabular-nums">
                  {balanceExchangePoints} <span className="font-medium text-zinc-500">pts</span>
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-t border-zinc-200/80 pt-2">
                <span className="min-w-0 shrink text-zinc-600">Consommation</span>
                <span className="shrink-0 tabular-nums">
                  {balanceConsumptionPoints} <span className="font-medium text-zinc-500">pts</span>
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-t border-zinc-300 pt-2 text-[13px] text-zinc-500">
                <span>Total utilisable</span>
                <span className="tabular-nums font-semibold text-zinc-800">{availablePoints} pts</span>
              </div>
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-2 text-[15px] font-semibold text-zinc-900">
              <span className="min-w-0 shrink text-zinc-600">Disponible</span>
              <SegnaPointsUnitDisplay
                points={availablePoints}
                creditKind={walletCreditKind}
                className="shrink-0"
                numberClassName="font-semibold tabular-nums text-zinc-900"
              />
            </div>
          )}

          <p className={segnaDialogBodyClass()}>{walletStateContent.description}</p>

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
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 px-3 text-center text-[15px] font-semibold text-white shadow-sm transition active:bg-zinc-800"
            >
              {walletStateContent.primaryCtaLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined" || !mounted) {
    return null;
  }

  return createPortal(overlay, document.body);
}
