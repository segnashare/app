"use client";

import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "framer-motion";

export type WalletBalanceChangeBurst = {
  id: number;
  delta: number;
};

export type WalletPillBalanceMotion = {
  burst: WalletBalanceChangeBurst | null;
  pulseKind: "credit" | "debit" | null;
  /** Direction du glissement du solde affiché (crédit = monte, débit = descend). */
  slideFromY: number;
};

export function useWalletPillBalanceAnimation(
  availablePoints: number,
  options?: { enabled?: boolean },
): WalletPillBalanceMotion {
  const enabled = options?.enabled !== false;
  const reducedMotion = useReducedMotion();
  const prevBalanceRef = useRef(availablePoints);
  const skipFirstRef = useRef(true);
  const [burst, setBurst] = useState<WalletBalanceChangeBurst | null>(null);
  const [pulseKind, setPulseKind] = useState<"credit" | "debit" | null>(null);
  const [slideFromY, setSlideFromY] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      prevBalanceRef.current = availablePoints;
      return;
    }

    const prev = prevBalanceRef.current;
    prevBalanceRef.current = availablePoints;
    if (prev === availablePoints) return;

    const delta = availablePoints - prev;
    if (delta === 0) return;

    setSlideFromY(delta > 0 ? 6 : -6);

    if (reducedMotion) return;

    const id = Date.now();
    const kind = delta > 0 ? "credit" : "debit";
    setBurst({ id, delta });
    setPulseKind(kind);

    const burstTimer = window.setTimeout(() => {
      setBurst((current) => (current?.id === id ? null : current));
    }, 1500);

    const pulseTimer = window.setTimeout(() => {
      setPulseKind((current) => (current === kind ? null : current));
    }, 650);

    return () => {
      window.clearTimeout(burstTimer);
      window.clearTimeout(pulseTimer);
    };
  }, [availablePoints, enabled, reducedMotion]);

  return { burst, pulseKind, slideFromY };
}
