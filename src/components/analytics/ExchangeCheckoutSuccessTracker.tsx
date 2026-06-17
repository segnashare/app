"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { trackClientEvent } from "@/lib/analytics/track-client";

/**
 * Captures `order_confirmed` after Stripe / wallet checkout redirect to `/exchange?cart=success`.
 */
export function ExchangeCheckoutSuccessTracker(): null {
  const searchParams = useSearchParams();
  const router = useRouter();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    if (searchParams.get("cart") !== "success") return;

    handledRef.current = true;

    const cartId = searchParams.get("cart_id")?.trim() ?? "";
    const checkoutMode = searchParams.get("checkout_mode")?.trim() || "stripe";

    trackClientEvent(
      "order_confirmed",
      {
        cart_id: cartId || "unknown",
        checkout_mode: checkoutMode as "stripe" | "wallet_setup" | "wallet_only",
      },
      cartId ? { insertId: `order_confirmed:${cartId}` } : undefined,
    );

    router.replace("/exchange");
  }, [router, searchParams]);

  return null;
}
