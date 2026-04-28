"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { Info } from "lucide-react";

import { ExchangeWalletPill } from "@/components/exchange/ExchangeWalletPill";
import { SegnaDialogDismissButton } from "@/components/ui/SegnaAppDialog";

type ExchangeHeaderProps = {
  membershipLabel: string;
  availablePoints: number;
  balanceConsumptionPoints: number;
  balanceExchangePoints: number;
  activeCartCostPoints: number | null;
  hasReachedLendingCap: boolean;
};



export function ExchangeHeader({
  membershipLabel,
  availablePoints,
  balanceConsumptionPoints,
  balanceExchangePoints,
  activeCartCostPoints,
  hasReachedLendingCap,
}: ExchangeHeaderProps) {
  const [membershipModalOpen, setMembershipModalOpen] = useState(false);

  const subscriberMembershipDescription = useMemo(() => {
    if (membershipLabel === "Membre X") {
      return "Tu es sur le plan Membre X. Tu beneficies des plafonds les plus eleves et de la priorite sur les echanges.";
    }
    if (membershipLabel === "Membre +") {
      return "Tu es sur le plan Membre +. Tu peux louer et preter avec des limites intermediaires.";
    }
    return null;
  }, [membershipLabel]);
  const membershipOffersHref = membershipLabel === "Guest" ? "/package?plan=x" : "/package";

  return (
    <>
      <header className="flex items-start justify-between gap-3 px-5 pb-4 pt-8">
        <button
          type="button"
          onClick={() => setMembershipModalOpen(true)}
          className="-mt-1 inline-flex items-center gap-2 bg-transparent text-left"
        >
          <span className={`${montserrat.className} text-[34px] font-extrabold leading-none text-zinc-950`}>{membershipLabel}</span>
          <Info className="h-4 w-4 text-zinc-500" />
        </button>

        <ExchangeWalletPill
          membershipLabel={membershipLabel}
          availablePoints={availablePoints}
          balanceConsumptionPoints={balanceConsumptionPoints}
          balanceExchangePoints={balanceExchangePoints}
          activeCartCostPoints={activeCartCostPoints}
          hasReachedLendingCap={hasReachedLendingCap}
          cartExceedsWallet={activeCartCostPoints != null && activeCartCostPoints > availablePoints}
        />
      </header>

      {membershipModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="relative w-full max-w-[400px] rounded-2xl bg-white p-5 shadow-xl">
            <SegnaDialogDismissButton onClick={() => setMembershipModalOpen(false)} />
            <div className="flex items-center gap-2 pr-10">
              <Info className="h-4 w-4 text-zinc-700" />
              <p className="text-lg font-semibold text-zinc-950">{membershipLabel}</p>
            </div>
            {membershipLabel === "Guest" ? (
              <div className="mt-2 space-y-2 text-sm text-zinc-600">
                <p>Tu es en mode Guest : tu peux emprunter et utiliser tes crédits d&apos;échange.</p>
                <p>
                  Avec une adhésion SegnaX, tu débloques plus de crédits, des plafonds plus confortables et les livraisons
                  incluses.
                </p>
              </div>
            ) : subscriberMembershipDescription ? (
              <p className="mt-2 text-sm text-zinc-600">{subscriberMembershipDescription}</p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMembershipModalOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-800"
              >
                Fermer
              </button>
              <Link
                href={membershipOffersHref}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white"
                onClick={() => setMembershipModalOpen(false)}
              >
                {membershipLabel === "Guest" ? "Découvrir l'adhésion" : "Voir les offres"}
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
