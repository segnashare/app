"use client";

import { useCallback, useEffect, useState } from "react";

import {
  SEGNA_DIALOG_SHEET_CLASS,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import type { SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaInlineActionLinkClass } from "@/lib/ui/segna-inline-link";
import { cn } from "@/lib/utils/cn";

type EmpruntBorrowDelayLearnMoreProps = {
  membershipLabel: SegnaBorrowMembershipLabel;
  className?: string;
};

/**
 * Lien « En savoir plus » + feuille d’explication (délais d’emprunt, retard, relais).
 * Style aligné sur la page évaluation pièce.
 */
export function EmpruntBorrowDelayLearnMore({ membershipLabel: _membershipLabel, className }: EmpruntBorrowDelayLearnMoreProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(segnaInlineActionLinkClass, className)}>
        En savoir plus
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40"
          role="presentation"
          onClick={close}
        >
          <div className={SEGNA_DIALOG_SHEET_CLASS} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />
            <h2 className={segnaDialogTitleClass()}>En cas de retard</h2>

            <h3 className={cn(segnaMontserrat.className, "mt-5 text-[15px] font-bold leading-snug text-zinc-900")}>
              Que se passe-t-il ?
            </h3>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              Si la date limite est dépassée sans retour engagé, ton échange est considéré en{" "}
              <strong className="font-semibold text-zinc-900">retard</strong> : tu peux toujours{" "}
              <strong className="font-semibold text-zinc-900">prolonger l&apos;échange</strong> (si disponible) ou{" "}
              <strong className="font-semibold text-zinc-900">organiser ton retour</strong> depuis l&apos;app. Des
              rappels peuvent continuer tant que le colis n&apos;est pas déposé au relais. Les conséquences éventuelles
              (pénalités, suspension) sont détaillées dans les{" "}
              <a
                href="https://www.segnashare.com/conditions-location"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-600 underline decoration-blue-500/40 underline-offset-2 transition hover:text-blue-700"
              >
                conditions générales de location
              </a>
              .
            </p>

            <h3 className={cn(segnaMontserrat.className, "mt-5 text-[15px] font-bold leading-snug text-zinc-900")}>
              Dépôt au point relais
            </h3>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              Dès que ton colis retour est{" "}
              <strong className="font-semibold text-zinc-900">déposé au relais</strong> (scan enregistré), ton
              engagement sur les délais est réputé respecté, même si le transport vers Segna se poursuit.
            </p>

            <button
              type="button"
              onClick={close}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
