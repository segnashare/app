"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

import {
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
  SEGNA_DIALOG_SHEET_CLASS,
} from "@/components/ui/SegnaAppDialog";
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

type WalletInfoSegment = {
  text: string;
  strong?: boolean;
};

const DEFAULT_WALLET_INFO_COPY: WalletInfoSegment[][] = [
  [
    { text: "Pour valider un panier, tu peux combiner tes " },
    { text: "Crédits d’échange", strong: true },
    { text: " (gagnés en prêtant tes pièces) et tes " },
    { text: "Crédits SegnaX", strong: true },
    { text: " (achetés ou gagnés dans l’app)." },
  ],
  [
    { text: "À la fin de l’échange, tes " },
    { text: "Crédits d’échange", strong: true },
    { text: " te sont " },
    { text: "rendus", strong: true },
    { text: " sur ton wallet, alors que tes " },
    { text: "Crédits SegnaX", strong: true },
    { text: " sont " },
    { text: "définitivement consommés", strong: true },
    { text: "." },
  ],
];

function walletInfoCopy(openInfo: "exchange" | "segna-x" | null): WalletInfoSegment[][] {
  if (openInfo === "exchange") {
    return [[{ text: "Crédits gagnés en prêtant tes pièces", strong: true }, { text: ". Ils servent de dépôt pendant la durée de l’échange et te sont recrédités à la fin." }]];
  }
  if (openInfo === "segna-x") {
    return [[{ text: "Crédits consommables", strong: true }, { text: ", achetés ou gagnés dans l’app. Une fois utilisés, ils ne sont pas rendus." }]];
  }
  return DEFAULT_WALLET_INFO_COPY;
}

/**
 * Bottom sheet (poignée, titre Montserrat, séparateur) : deux CTA pleine largeur — secondaire blanc bord noir, principal noir.
 */
export function WalletPanel({
  open,
  onClose,
  availablePoints,
  balanceConsumptionPoints,
  balanceExchangePoints,
  walletStateContent,
}: WalletPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [openInfo, setOpenInfo] = useState<"exchange" | "segna-x" | null>(null);
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

  const infoCopy = walletInfoCopy(openInfo);

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
          <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 text-[14px] font-semibold text-zinc-900">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 shrink items-center gap-1.5 text-zinc-600">
                  <span>Crédits d&apos;échange</span>
                  <button
                    type="button"
                    aria-label="Informations sur les crédits d'échange"
                    aria-expanded={openInfo === "exchange"}
                    onClick={() => setOpenInfo((current) => (current === "exchange" ? null : "exchange"))}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-zinc-950 transition active:opacity-60"
                  >
                    <Info className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </span>
                <span className="shrink-0 tabular-nums">
                  {balanceExchangePoints} <span className="font-medium text-zinc-500">pts</span>
                </span>
              </div>
            </div>
            <div className="space-y-1.5 border-t border-zinc-200/80 pt-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 shrink items-center gap-1.5 text-zinc-600">
                  <span>Crédits SegnaX</span>
                  <button
                    type="button"
                    aria-label="Informations sur les crédits SegnaX"
                    aria-expanded={openInfo === "segna-x"}
                    onClick={() => setOpenInfo((current) => (current === "segna-x" ? null : "segna-x"))}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-zinc-950 transition active:opacity-60"
                  >
                    <Info className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </span>
                <span className="shrink-0 tabular-nums">
                  {balanceConsumptionPoints} <span className="font-medium text-zinc-500">pts</span>
                </span>
              </div>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t border-zinc-300 pt-2 text-[15px] text-zinc-950">
              <span>Total utilisable</span>
              <span className="tabular-nums font-semibold">{availablePoints} pts</span>
            </div>
          </div>

          <div className="space-y-2 text-center">
            {infoCopy.map((line, lineIndex) => (
              <p key={lineIndex} className={segnaDialogBodyClass("text-[12px] sm:text-[13px]")}>
                {line.map((segment, segmentIndex) =>
                  segment.strong ? (
                    <strong key={`${lineIndex}-${segmentIndex}`} className="font-bold text-zinc-900">
                      {segment.text}
                    </strong>
                  ) : (
                    <span key={`${lineIndex}-${segmentIndex}`}>{segment.text}</span>
                  ),
                )}
              </p>
            ))}
          </div>

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
      </div>
    </div>
  );

  if (typeof document === "undefined" || !mounted) {
    return null;
  }

  return createPortal(overlay, document.body);
}
