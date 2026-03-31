"use client";

import { useMemo, useState } from "react";
import { Montserrat } from "next/font/google";
import Link from "next/link";

import { Info } from "lucide-react";

import { ExchangeWalletPill } from "@/components/exchange/ExchangeWalletPill";

type ExchangeHeaderProps = {
  membershipLabel: string;
  availablePoints: number;
  blockedPoints: number;
  totalPoints: number;
  activeCartCostPoints: number | null;
  hasReachedLendingCap: boolean;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["700", "800"],
});

export function ExchangeHeader({
  membershipLabel,
  availablePoints,
  activeCartCostPoints,
  hasReachedLendingCap,
}: ExchangeHeaderProps) {
  const [membershipModalOpen, setMembershipModalOpen] = useState(false);

  const membershipDescription = useMemo(() => {
    if (membershipLabel === "Membre X") {
      return "Tu es sur le plan Membre X. Tu beneficies des plafonds les plus eleves et de la priorite sur les echanges.";
    }
    if (membershipLabel === "Membre +") {
      return "Tu es sur le plan Membre +. Tu peux louer et preter avec des limites intermediaires.";
    }
    return "Tu es en mode Guest. Passe sur un abonnement pour activer les echanges et debloquer plus de credits.";
  }, [membershipLabel]);
  const membershipOffersHref = membershipLabel === "Membre +" ? "/package?plan=minus" : "/package";

  return (
    <>
      <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-8">
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
          activeCartCostPoints={activeCartCostPoints}
          hasReachedLendingCap={hasReachedLendingCap}
          cartExceedsWallet={activeCartCostPoints != null && activeCartCostPoints > availablePoints}
        />
      </header>

      {membershipModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-[400px] rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-zinc-700" />
              <p className="text-lg font-semibold text-zinc-950">{membershipLabel}</p>
            </div>
            <p className="mt-2 text-sm text-zinc-600">{membershipDescription}</p>
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
                Voir les offres
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
