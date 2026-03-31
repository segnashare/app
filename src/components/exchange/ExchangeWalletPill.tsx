"use client";

import { useEffect, useMemo, useState } from "react";

import { ChevronDown } from "lucide-react";

import { WalletPanel, type WalletPanelStateContent } from "@/components/exchange/WalletPanel";
import { cn } from "@/lib/utils/cn";

type ExchangeWalletPillProps = {
  membershipLabel: string;
  availablePoints: number;
  /** Somme des points des lignes du panier actif, ou null si aucun panier. */
  activeCartCostPoints: number | null;
  hasReachedLendingCap: boolean;
  /** Total panier > capacité emprunt (mods / pods) : pastille alerte (fond blanc, texte et bordure rouges). */
  cartExceedsWallet?: boolean;
  /** Ouverture / fermeture du panneau Wallet (ex. masquer le CTA panier). */
  onWalletPanelOpenChange?: (open: boolean) => void;
  className?: string;
};

export function ExchangeWalletPill({
  membershipLabel,
  availablePoints,
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
  const balanceUnitLabel = membershipLabel === "Guest" ? "pods" : "mods";
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
        primaryCtaLabel: "Obtenir des pods",
        primaryCtaHref: "/profile?tab=obtenirplus",
        secondaryCtaLabel: "Passe à l'échange",
        secondaryCtaHref: "/package?plan=plus",
      };
    }

    if (walletState === "segna_plus_cap_reached") {
      return {
        title: "Plafond Segna+ atteint",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
        primaryCtaLabel: "Passer à SegnaX",
        primaryCtaHref: "/package?plan=minus",
        secondaryCtaLabel: "Obtenir des mods",
        secondaryCtaHref: "/profile?tab=obtenirplus",
      };
    }

    if (walletState === "segna_x_cap_reached") {
      return {
        title: "Plafond de prêt atteint",
        description: "Tu as atteint le nombre maximum de pièces en prêt simultané pour ton abonnement.",
        primaryCtaLabel: "Obtenir des mods",
        primaryCtaHref: "/profile?tab=obtenirplus",
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
      secondaryCtaLabel: "Obtenir des mods",
      secondaryCtaHref: "/profile?tab=obtenirplus",
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
            ? "cart-wallet-exceed-vibrate border-2 border-current bg-white text-red-600 shadow-sm"
            : "bg-gradient-to-r from-[#5E3023] to-[#895737] text-white",
          className,
        )}
      >
        <span className="min-w-0 truncate text-sm font-semibold">{walletPillLabel}</span>
        {cartExceedsWallet ? (
          <span
            aria-hidden
            className="inline-block h-5 w-5 shrink-0 bg-current"
            style={{
              maskImage: "url(/ressources/icons/segna.svg)",
              maskSize: "contain",
              maskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskImage: "url(/ressources/icons/segna.svg)",
              WebkitMaskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
            }}
          />
        ) : (
          <img src="/ressources/icons/segna.svg" alt="" aria-hidden className="h-4 w-4 shrink-0 brightness-0 invert" />
        )}
        <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={2.25} />
      </button>

      <WalletPanel
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        availablePoints={availablePoints}
        balanceUnitLabel={balanceUnitLabel}
        walletStateContent={walletStateContent}
      />
    </>
  );
}
