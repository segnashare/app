"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { WalletBalanceChangeBurst } from "@/components/exchange/useWalletPillBalanceAnimation";
import { cn } from "@/lib/utils/cn";

type WalletPillAnimatedBalanceProps = {
  availablePoints: number;
  cartExceedsWallet?: boolean;
  burst: WalletBalanceChangeBurst | null;
  slideFromY: number;
  className?: string;
};

export function WalletPillAnimatedBalance({
  availablePoints,
  cartExceedsWallet = false,
  burst,
  slideFromY,
  className,
}: WalletPillAnimatedBalanceProps) {
  const reducedMotion = useReducedMotion();

  return (
    <span className={cn("relative inline-flex min-w-[1.25rem] shrink-0 items-center justify-center", className)}>
      <motion.span
        key={reducedMotion ? "static" : availablePoints}
        initial={reducedMotion ? false : { y: slideFromY, opacity: 0.35 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 440, damping: 30 }}
        className="min-w-0 truncate text-sm font-semibold tabular-nums"
      >
        {availablePoints}
      </motion.span>

      <AnimatePresence>
        {burst && !reducedMotion ? (
          <motion.span
            key={burst.id}
            initial={{ opacity: 0, y: 4, scale: 0.88 }}
            animate={{ opacity: 1, y: -16, scale: 1 }}
            exit={{ opacity: 0, y: -26, scale: 0.92 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold tabular-nums leading-none",
              burst.delta > 0
                ? cartExceedsWallet
                  ? "text-emerald-600"
                  : "text-emerald-400"
                : cartExceedsWallet
                  ? "text-amber-600"
                  : "text-amber-300",
            )}
            aria-hidden
          >
            {burst.delta > 0 ? `+${burst.delta}` : `−${Math.abs(burst.delta)}`}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
