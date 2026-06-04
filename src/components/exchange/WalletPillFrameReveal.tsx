"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { useAnimate, useReducedMotion } from "framer-motion";

import { formatWalletTransactionSignedAmount } from "@/lib/wallet/wallet-transaction-announcement";
import type { WalletTransactionAnnouncement } from "@/lib/wallet/wallet-transaction-announcement";
import {
  WALLET_PILL_EASE_IN_OUT,
  WALLET_PILL_EASE_OUT,
} from "@/lib/wallet/wallet-pill-frame-animation";
import { cn } from "@/lib/utils/cn";

type WalletPillFrameRevealProps = {
  animation: Pick<WalletTransactionAnnouncement, "direction" | "amountPoints">;
  availablePoints: number;
  cartExceedsWallet?: boolean;
  onComplete: () => void;
};

const BALANCE_CLASS = "min-w-0 truncate text-sm font-semibold tabular-nums";

export function WalletPillFrameReveal({
  animation,
  availablePoints,
  cartExceedsWallet = false,
  onComplete,
}: WalletPillFrameRevealProps) {
  const reducedMotion = useReducedMotion();
  const [scope, animate] = useAnimate();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const signedLabel = formatWalletTransactionSignedAmount(animation.direction, animation.amountPoints);

  useLayoutEffect(() => {
    if (reducedMotion) {
      onCompleteRef.current();
      return;
    }

    const root = scope.current;
    if (!root) return;

    let cancelled = false;

    const run = async () => {
      const delta = root.querySelector<HTMLElement>("[data-wallet-pill-delta]");
      const balance = root.querySelector<HTMLElement>("[data-wallet-pill-balance]");
      if (!delta || !balance) {
        onCompleteRef.current();
        return;
      }

      await animate(
        delta,
        { opacity: [0, 1], scale: [0.94, 1], y: [5, 0], filter: ["blur(3px)", "blur(0px)"] },
        { duration: 0.52, ease: WALLET_PILL_EASE_OUT },
      );
      if (cancelled) return;

      await new Promise((resolve) => window.setTimeout(resolve, 980));
      if (cancelled) return;

      await Promise.all([
        animate(
          delta,
          { opacity: [1, 0], y: [0, -4], scale: [1, 0.98], filter: ["blur(0px)", "blur(2px)"] },
          { duration: 0.42, ease: WALLET_PILL_EASE_IN_OUT },
        ),
        animate(
          balance,
          { opacity: [0, 1], y: [4, 0], scale: [0.97, 1], filter: ["blur(2px)", "blur(0px)"] },
          { duration: 0.48, ease: WALLET_PILL_EASE_OUT, delay: 0.12 },
        ),
      ]);
      if (cancelled) return;

      await new Promise((resolve) => window.setTimeout(resolve, 280));
      if (!cancelled) onCompleteRef.current();
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [animate, reducedMotion, signedLabel, availablePoints]);

  if (reducedMotion) {
    return <span className={BALANCE_CLASS}>{availablePoints}</span>;
  }

  return (
    <span
      ref={scope}
      className="relative inline-flex h-[1.25rem] min-w-[1.75rem] shrink-0 items-center justify-center"
    >
      <span
        data-wallet-pill-delta
        className={cn(
          "absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums leading-none will-change-[transform,opacity]",
          cartExceedsWallet ? "text-zinc-900" : "text-white",
        )}
        style={{ opacity: 0 }}
        aria-hidden
      >
        {signedLabel}
      </span>
      <span
        data-wallet-pill-balance
        className={cn(
          BALANCE_CLASS,
          "absolute inset-0 flex items-center justify-center will-change-[transform,opacity]",
        )}
        style={{ opacity: 0 }}
      >
        {availablePoints}
      </span>
      <span className={cn(BALANCE_CLASS, "invisible")} aria-hidden>
        {availablePoints}
      </span>
    </span>
  );
}
