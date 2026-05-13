"use client";

import { useEffect, useMemo, useState } from "react";

import { ChevronDown } from "lucide-react";

import { WalletPanel, type WalletPanelStateContent } from "@/components/exchange/WalletPanel";
import { SEGNA_BRAND_LOGO_SRC } from "@/lib/brand/segna-mark";
import { cn } from "@/lib/utils/cn";

type ExchangeWalletPillProps = {
  membershipLabel: string;
  availablePoints: number;
  /** Solde crédits de consommation (persisté `balance_consumption_points`). */
  balanceConsumptionPoints: number;
  /** Solde crédits d'échange (persisté `balance_exchange_points`). */
  balanceExchangePoints: number;
  /** Somme des points des lignes du panier actif, ou null si aucun panier. */
  activeCartCostPoints: number | null;
  hasReachedLendingCap: boolean;
  /** Total panier > capacité emprunt : pastille contrastée (sans rouge ni animation). */
  cartExceedsWallet?: boolean;
  /** Ouverture / fermeture du panneau Wallet (ex. masquer le CTA panier). */
  onWalletPanelOpenChange?: (open: boolean) => void;
  className?: string;
};

export function ExchangeWalletPill({
  membershipLabel,
  availablePoints,
  balanceConsumptionPoints,
  balanceExchangePoints,
  activeCartCostPoints,
  hasReachedLendingCap,
  cartExceedsWallet = false,
  onWalletPanelOpenChange,
  className,
}: ExchangeWalletPillProps) {
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  useEffect(() => {
    onWalletPanelOpenChange?.(walletModalOpen);
  }, [walletModalOpen, onWalletPanelOpenChange]);

  const hasActiveCart = activeCartCostPoints !== null;
  const walletPillLabel = hasActiveCart
    ? `${activeCartCostPoints} / ${availablePoints}`
    : `${availablePoints}`;

  const walletState = useMemo(() => {
    if (membershipLabel === "Guest") return "guest";
    if (membershipLabel === "Membre +" && hasReachedLendingCap) return "segna_plus_cap_reached";
    if (membershipLabel === "Membre X" && hasReachedLendingCap) return "segna_x_cap_reached";
    return "subscriber_not_maxed";
  }, [hasReachedLendingCap, membershipLabel]);

  const walletStateContent = useMemo<WalletPanelStateContent>(() => {
    if (walletState === "guest") {
      return {
        title: "Mode Guest",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
        primaryCtaLabel: "Obtenir des crédits.",
        primaryCtaHref: "/package?plan=credits",
        secondaryCtaLabel: "Devenir membre SegnaX",
        secondaryCtaHref: "/package?plan=x",
      };
    }

    if (walletState === "segna_plus_cap_reached") {
      return {
        title: "Plafond Segna+ atteint",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
        primaryCtaLabel: "Voir les offres Segna+",
        primaryCtaHref: "/package",
        secondaryCtaLabel: "Obtenir des crédits.",
        secondaryCtaHref: "/package?plan=credits",
      };
    }

    if (walletState === "segna_x_cap_reached") {
      return {
        title: "Plafond de prêt atteint",
        description: "Tu as atteint le nombre maximum de pièces en prêt simultané pour ton abonnement.",
        primaryCtaLabel: "Obtenir des crédits.",
        primaryCtaHref: "/package?plan=credits",
        secondaryCtaLabel: "Comprendre",
        secondaryCtaHref: "/package",
      };
    }

    return {
      title: "Capacité de prêt disponible",
      description:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
      primaryCtaLabel: "Ajouter",
      primaryCtaHref: "/shop",
      secondaryCtaLabel: "Obtenir des crédits.",
      secondaryCtaHref: "/package?plan=credits",
    };
  }, [walletState]);

  return (
    <>
      <button
        type="button"
        onClick={() => setWalletModalOpen(true)}
        className={cn(
          "relative z-20 inline-flex items-center gap-2 rounded-[14px] px-3 py-2 text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
          cartExceedsWallet
            ? "border-2 border-zinc-300 bg-white text-zinc-900 shadow-sm"
            : "bg-zinc-950 text-white shadow-sm",
          className,
        )}
      >
        <span className="min-w-0 truncate text-sm font-semibold">{walletPillLabel}</span>
        {cartExceedsWallet ? (
          <img
            src={SEGNA_BRAND_LOGO_SRC}
            alt=""
            aria-hidden
            className="h-4 w-auto max-w-[3.75rem] shrink-0 object-contain object-left"
          />
        ) : (
          <img
            src={SEGNA_BRAND_LOGO_SRC}
            alt=""
            aria-hidden
            className="h-4 w-auto max-w-[3.75rem] shrink-0 object-contain object-left invert"
          />
        )}
        <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={2.25} />
      </button>

      <WalletPanel
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        availablePoints={availablePoints}
        balanceConsumptionPoints={balanceConsumptionPoints}
        balanceExchangePoints={balanceExchangePoints}
        walletStateContent={walletStateContent}
      />
    </>
  );
}
