"use client";

import Link from "next/link";
import { Playfair_Display } from "next/font/google";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "700",
});

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
  balanceUnitLabel: string;
  walletStateContent: WalletPanelStateContent;
};

export function WalletPanel({ open, onClose, availablePoints, balanceUnitLabel, walletStateContent }: WalletPanelProps) {
  if (!open) return null;
  const isGuestBalance = balanceUnitLabel.toLowerCase() === "pods";
  const balanceLabel = isGuestBalance ? "Crédits de location" : "Crédits d'échange";

  return (
    <div className="fixed inset-0 z-[60] bg-black/18 backdrop-blur-[3px]" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom)+12px)] flex justify-center px-4 md:bottom-[88px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="w-full max-w-[398px] rounded-[22px] bg-gradient-to-b from-[#5E3023] to-[#895737] px-5 pb-6 pt-3 text-white shadow-[0_12px_34px_rgba(20,10,6,0.42)]">
          <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/70" aria-hidden />

          <h3 className={`${playfairDisplay.className} text-center text-[40px] font-bold leading-none`}>Wallet</h3>

          <div className="mt-6 flex items-center justify-between text-[23px] font-bold leading-none">
            <span>{balanceLabel}</span>
            <span>{availablePoints} {balanceUnitLabel}</span>
          </div>

          <div className="mt-4 rounded-xl bg-white/14 px-3 py-2 text-[12px] leading-[1.35] text-zinc-100/95">{walletStateContent.description}</div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link
              href={walletStateContent.secondaryCtaHref}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-white px-3 text-base font-semibold text-[#5E3023]"
            >
              {walletStateContent.secondaryCtaLabel}
            </Link>
            <Link
              href={walletStateContent.primaryCtaHref}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/65 px-3 text-base font-semibold text-white"
            >
              {walletStateContent.primaryCtaLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
