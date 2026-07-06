"use client";

import { Suspense, useLayoutEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  clearPostSubmitBlock,
  hasFromItemSession,
  isPostSubmitBlocked,
  setFromItemSession,
} from "@/lib/items/new-item-nav";

/**
 * Après soumission, si l’item est marqué « soumis » et qu’on n’est pas dans une session « modifier »
 * (?from=item / session), on renvoie vers la fiche pièce au lieu de réouvrir le formulaire.
 */
function NewItemStackGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const itemId = searchParams.get("itemId")?.trim() ?? null;
  const fromItem = searchParams.get("from") === "item";

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (!pathname?.startsWith("/items/new")) return;
    if (!itemId) return;

    if (fromItem) {
      setFromItemSession();
      clearPostSubmitBlock(itemId);
      return;
    }

    if (hasFromItemSession()) return;

    if (!isPostSubmitBlocked(itemId)) return;

    window.location.replace(`${window.location.origin}/items/${encodeURIComponent(itemId)}`);
  }, [pathname, itemId, fromItem]);

  return <>{children}</>;
}

export default function NewItemClientLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-[#fafafa]" aria-hidden />}>
      <NewItemStackGuard>{children}</NewItemStackGuard>
    </Suspense>
  );
}
