"use client";

import { useEffect, type ReactNode } from "react";

import { CART_RESERVED_AT_STORAGE_KEY } from "@/lib/cart/reservation-timer";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** Évite le faux « leave » en React Strict Mode (double montage du layout). */
let paymentFlowLayoutGeneration = 0;
const HOLD_RELEASE_UNMOUNT_DEBOUNCE_MS = 280;

async function releasePaymentCartHoldClient(cartId: string) {
  const supabase = createSupabaseBrowserClient();
  try {
    await supabase.rpc("release_wallet_hold", {
      p_cart_id: cartId,
      p_reason: "payment_flow_exit",
    });
  } finally {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(CART_RESERVED_AT_STORAGE_KEY);
    }
  }
}

/**
 * À placer sur le layout `/cart/payment/*` : libère le hold à la sortie du flux (pas entre sous-pages).
 */
export function PaymentHoldReleaseBoundary({
  activeCartId,
  children,
}: {
  activeCartId: string | null;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!activeCartId) return;
    const myGen = ++paymentFlowLayoutGeneration;
    return () => {
      const genAtUnmount = myGen;
      window.setTimeout(() => {
        if (genAtUnmount !== paymentFlowLayoutGeneration) return;
        void releasePaymentCartHoldClient(activeCartId);
      }, HOLD_RELEASE_UNMOUNT_DEBOUNCE_MS);
    };
  }, [activeCartId]);

  useEffect(() => {
    if (!activeCartId) return;
    const onPageHide = () => {
      void releasePaymentCartHoldClient(activeCartId);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [activeCartId]);

  return <>{children}</>;
}
