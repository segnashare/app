"use client";

import { useMemo, useState } from "react";
import { Montserrat } from "next/font/google";
import Link from "next/link";

import { ChevronDown, Info } from "lucide-react";

import { WalletPanel, type WalletPanelStateContent } from "@/components/exchange/WalletPanel";
import { cn } from "@/lib/utils/cn";

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

export function ExchangeHeader({ membershipLabel, availablePoints, blockedPoints, totalPoints, activeCartCostPoints, hasReachedLendingCap }: ExchangeHeaderProps) {
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [membershipModalOpen, setMembershipModalOpen] = useState(false);

  const hasActiveCart = activeCartCostPoints !== null;
  const balanceUnitLabel = membershipLabel === "Guest" ? "pods" : "mods";
  const walletPillLabel = hasActiveCart ? `${activeCartCostPoints} / ${availablePoints} ${balanceUnitLabel}` : `${availablePoints} ${balanceUnitLabel}`;

  const walletState = useMemo(() => {
    if (membershipLabel === "Guest") return "guest";
    if (membershipLabel === "Membre +" && hasReachedLendingCap) return "segna_plus_cap_reached";
    return "subscriber_not_maxed";
  }, [hasReachedLendingCap, membershipLabel]);

  const walletStateContent = useMemo<WalletPanelStateContent>(() => {
    if (walletState === "guest") {
      return {
        title: "Mode Guest",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
        primaryCtaLabel: "Obtenir des pods",
        primaryCtaHref: "/profile?tab=obtenirplus",
        secondaryCtaLabel: "Passe à l'échange",
        secondaryCtaHref: "/package?plan=plus",
      };
    }

    if (walletState === "segna_plus_cap_reached") {
      return {
        title: "Plafond Segna+ atteint",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
        primaryCtaLabel: "Passer à SegnaX",
        primaryCtaHref: "/package?plan=minus",
        secondaryCtaLabel: "Obtenir des mods",
        secondaryCtaHref: "/profile?tab=obtenirplus",
      };
    }

    return {
      title: "Capacité de prêt disponible",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
      primaryCtaLabel: "Ajouter",
      primaryCtaHref: "/shop",
      secondaryCtaLabel: "Obtenir des mods",
      secondaryCtaHref: "/profile?tab=obtenirplus",
    };
  }, [walletState]);

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

        <button
          type="button"
          onClick={() => setWalletModalOpen(true)}
          className={cn(
            "relative z-20 inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#5E3023] to-[#895737] px-3 py-2 text-left text-white outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
          )}
        >
          <img src="/ressources/icons/oeil_logo.svg" alt="" aria-hidden className="h-4 w-4 shrink-0 brightness-0 invert" />
          <span className="text-sm font-semibold">{walletPillLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </button>
      </header>

      <WalletPanel
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        availablePoints={availablePoints}
        balanceUnitLabel={balanceUnitLabel}
        walletStateContent={walletStateContent}
      />

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
