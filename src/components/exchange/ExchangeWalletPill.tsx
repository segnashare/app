"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ChevronDown } from "lucide-react";
import { motion, useAnimate, useReducedMotion } from "framer-motion";

import { useExchangeWalletAnnouncement } from "@/components/exchange/ExchangeWalletAnnouncementContext";
import { useWalletPillBalanceAnimation } from "@/components/exchange/useWalletPillBalanceAnimation";
import { WalletPanel } from "@/components/exchange/WalletPanel";
import { WalletPillAnimatedBalance } from "@/components/exchange/WalletPillAnimatedBalance";
import { WalletPillFrameReveal } from "@/components/exchange/WalletPillFrameReveal";
import { SEGNA_BRAND_LOGO_SRC } from "@/lib/brand/segna-mark";
import {
  WALLET_PILL_EASE_IN_OUT,
  WALLET_PILL_GROW_SCALE,
  WALLET_PILL_GROW_VIBRATE_MS,
  WALLET_PILL_SPRING,
} from "@/lib/wallet/wallet-pill-frame-animation";
import { cn } from "@/lib/utils/cn";

type ExchangeWalletPillProps = {
  membershipLabel: string;
  availablePoints: number;
  /** Total panier > capacité emprunt : pastille contrastée (sans rouge ni animation). */
  cartExceedsWallet?: boolean;
  /** Ouverture / fermeture du panneau Wallet (ex. masquer le CTA panier). */
  onWalletPanelOpenChange?: (open: boolean) => void;
  className?: string;
};

export function ExchangeWalletPill({
  membershipLabel,
  availablePoints,
  cartExceedsWallet = false,
  onWalletPanelOpenChange,
  className,
}: ExchangeWalletPillProps) {
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const announcementCtx = useExchangeWalletAnnouncement();
  const reducedMotion = useReducedMotion();
  const frameAnimation = announcementCtx?.frameAnimation ?? null;
  const passiveMotion = useWalletPillBalanceAnimation(availablePoints, {
    enabled: !announcementCtx?.suppressPassiveBalanceAnimation && !frameAnimation,
  });
  const { burst, pulseKind, slideFromY } = passiveMotion;

  useEffect(() => {
    onWalletPanelOpenChange?.(walletModalOpen);
  }, [walletModalOpen, onWalletPanelOpenChange]);

  const pillElRef = useRef<HTMLButtonElement | null>(null);
  const [, pillAnimate] = useAnimate();

  useLayoutEffect(() => {
    if (!frameAnimation || reducedMotion || !pillElRef.current) return;

    const pillEl = pillElRef.current;
    let cancelled = false;

    void (async () => {
      await pillAnimate(
        pillEl,
        { scale: WALLET_PILL_GROW_SCALE, x: 0, rotate: 0 },
        WALLET_PILL_SPRING.pillGrow,
      );
      if (cancelled) return;

      await pillAnimate(
        pillEl,
        {
          x: [0, -1, 1, -0.6, 0.6, 0],
          rotate: [0, -1.2, 1.2, -0.8, 0.8, 0],
          scale: WALLET_PILL_GROW_SCALE,
        },
        { duration: WALLET_PILL_GROW_VIBRATE_MS / 1000, ease: WALLET_PILL_EASE_IN_OUT },
      );
    })();

    return () => {
      cancelled = true;
      pillEl.style.transform = "";
    };
  }, [frameAnimation, pillAnimate, reducedMotion]);

  useLayoutEffect(() => {
    if (frameAnimation || reducedMotion || !pillElRef.current) return;
    pillElRef.current.style.transform = "";
  }, [frameAnimation, reducedMotion]);

  return (
    <>
      <motion.button
        ref={(node) => {
          pillElRef.current = node;
          announcementCtx?.registerPillRef(node);
        }}
        type="button"
        data-segna-wallet-pill
        onClick={() => setWalletModalOpen(true)}
        className={cn(
          "relative z-20 inline-flex origin-center items-center gap-2 overflow-visible rounded-[14px] px-3 py-2 text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
          cartExceedsWallet
            ? "border-2 border-zinc-300 bg-white text-zinc-900 shadow-sm"
            : "bg-zinc-950 text-white shadow-sm",
          !frameAnimation && pulseKind === "credit" && (cartExceedsWallet ? "wallet-pill-pulse-credit-light" : "wallet-pill-pulse-credit"),
          !frameAnimation && pulseKind === "debit" && (cartExceedsWallet ? "wallet-pill-pulse-debit-light" : "wallet-pill-pulse-debit"),
          className,
        )}
        aria-label={`Wallet : ${availablePoints} crédits Segna`}
      >
        {frameAnimation ? (
          <WalletPillFrameReveal
            animation={frameAnimation}
            availablePoints={availablePoints}
            cartExceedsWallet={cartExceedsWallet}
            onComplete={() => announcementCtx?.finishFrameAnimation()}
          />
        ) : (
          <WalletPillAnimatedBalance
            availablePoints={availablePoints}
            cartExceedsWallet={cartExceedsWallet}
            burst={burst}
            slideFromY={slideFromY}
          />
        )}
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
      </motion.button>

      <WalletPanel
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        availablePoints={availablePoints}
        membershipLabel={membershipLabel}
      />
    </>
  );
}
