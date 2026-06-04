"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type { WalletTransactionAnnouncement } from "@/lib/wallet/wallet-transaction-announcement";

export type WalletPillFrameAnimation = {
  id: number;
  direction: WalletTransactionAnnouncement["direction"];
  amountPoints: number;
};

type ExchangeWalletAnnouncementContextValue = {
  pillRef: RefObject<HTMLButtonElement | null>;
  registerPillRef: (node: HTMLButtonElement | null) => void;
  suppressPassiveBalanceAnimation: boolean;
  frameAnimation: WalletPillFrameAnimation | null;
  triggerPillFrameAnimation: (
    tx: Pick<WalletTransactionAnnouncement, "direction" | "amountPoints">,
    onComplete?: () => void,
  ) => void;
  clearFrameAnimation: () => void;
  finishFrameAnimation: () => void;
};

const ExchangeWalletAnnouncementContext = createContext<ExchangeWalletAnnouncementContextValue | null>(
  null,
);

export function ExchangeWalletAnnouncementProvider({
  children,
  suppressPassiveBalanceAnimation = true,
}: {
  children: ReactNode;
  suppressPassiveBalanceAnimation?: boolean;
}) {
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const [frameAnimation, setFrameAnimation] = useState<WalletPillFrameAnimation | null>(null);
  const onCompleteRef = useRef<(() => void) | null>(null);

  const registerPillRef = useCallback((node: HTMLButtonElement | null) => {
    pillRef.current = node;
  }, []);

  const clearFrameAnimation = useCallback(() => {
    setFrameAnimation(null);
    onCompleteRef.current = null;
  }, []);

  const triggerPillFrameAnimation = useCallback(
    (
      tx: Pick<WalletTransactionAnnouncement, "direction" | "amountPoints">,
      onComplete?: () => void,
    ) => {
      const id = Date.now();
      onCompleteRef.current = onComplete ?? null;
      setFrameAnimation({
        id,
        direction: tx.direction,
        amountPoints: tx.amountPoints,
      });
    },
    [],
  );

  const finishFrameAnimation = useCallback(() => {
    onCompleteRef.current?.();
    onCompleteRef.current = null;
    setFrameAnimation(null);
  }, []);

  const value = useMemo(
    () => ({
      pillRef,
      registerPillRef,
      suppressPassiveBalanceAnimation,
      frameAnimation,
      triggerPillFrameAnimation,
      clearFrameAnimation,
      finishFrameAnimation,
    }),
    [
      frameAnimation,
      registerPillRef,
      suppressPassiveBalanceAnimation,
      triggerPillFrameAnimation,
      clearFrameAnimation,
      finishFrameAnimation,
    ],
  );

  return (
    <ExchangeWalletAnnouncementContext.Provider value={value}>
      {children}
    </ExchangeWalletAnnouncementContext.Provider>
  );
}

export function useExchangeWalletAnnouncement(): ExchangeWalletAnnouncementContextValue | null {
  return useContext(ExchangeWalletAnnouncementContext);
}
