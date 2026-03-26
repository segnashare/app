"use client";

import Link from "next/link";
import { Montserrat } from "next/font/google";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: ["600", "500"] });

const storageKey = (itemId: string) => `segna:seen-logistics-refusal-modal:${itemId}`;

type Props = {
  itemId: string;
};

/**
 * Affichage unique après refus logistique : alerte avant le détail sur la page fiche.
 */
export function LogisticsRefusalEntryModal({ itemId }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(storageKey(itemId)) === "1") return;
    } catch {
      return;
    }
    setOpen(true);
  }, [itemId]);

  if (!open) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(storageKey(itemId), "1");
    } catch {
      // no-op
    }
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
      <div
        className="w-full max-w-[400px] rounded-2xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logistics-refusal-modal-title"
      >
        <h2
          id="logistics-refusal-modal-title"
          className={cn(montserrat.className, "text-lg font-semibold text-zinc-900")}
        >
          Refus après contrôle
        </h2>
        <p className={cn(montserrat.className, "mt-3 text-sm leading-relaxed text-zinc-600")}>
          Ta pièce n&apos;a pas été retenue suite à la vérification physique. Elle reste visible dans tes prêts avec le
          statut « Refus contrôle ». Tu peux consulter le motif et la suite à donner (retour, litige) sur la page
          dédiée.
        </p>
        <div className="mt-5 grid gap-2">
          <Link
            href={`/items/${itemId}/refus-logistique`}
            onClick={dismiss}
            className={cn(
              montserrat.className,
              "flex h-11 items-center justify-center rounded-xl bg-[#5E3023] text-center text-sm font-semibold text-white",
            )}
          >
            Voir les détails
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className={cn(
              montserrat.className,
              "h-11 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-800",
            )}
          >
            Compris
          </button>
        </div>
      </div>
    </div>
  );
}
