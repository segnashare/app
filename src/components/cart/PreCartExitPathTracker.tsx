"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { isCartFlowPathname, rememberPathForCartExit } from "@/lib/cart/pre-cart-exit-path";

/**
 * Mémorise la dernière route hors `/cart` pour que la croix / sortie du flux
 * renvoie vers cette page plutôt que `history.back()` (panier / paiement).
 */
export function PreCartExitPathTracker() {
  const pathname = usePathname() ?? "";

  useEffect(() => {
    if (isCartFlowPathname(pathname)) return;
    rememberPathForCartExit(pathname);
  }, [pathname]);

  return null;
}
