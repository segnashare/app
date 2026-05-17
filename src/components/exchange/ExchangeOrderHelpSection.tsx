"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";

import { Mail, Phone } from "lucide-react";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { getSegnaSupportContact, supportTelHref } from "@/lib/config/support-contact";
import { cn } from "@/lib/utils/cn";

const contactBtnClass =
  "flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-100 px-4 py-3.5 text-[15px] font-semibold text-zinc-900 transition hover:bg-zinc-200/90 active:scale-[0.99]";

const triggerClass = cn(
  "p-0 text-[13px] font-medium text-zinc-500 underline decoration-zinc-400/80 underline-offset-[3px] transition hover:text-zinc-800 hover:decoration-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400",
);

type ExchangeOrderHelpSectionProps = {
  /** `header` : coin haut droit à côté du bouton fermer ; `footer` : sous le contenu. */
  placement?: "header" | "footer";
  /** Libellé du lien déclencheur (défaut : aide commande). */
  triggerLabel?: string;
};

/**
 * Lien « Aide commande » ouvrant une modale (suivi commande / emprunt / litige).
 */
export function ExchangeOrderHelpSection({
  placement = "footer",
  triggerLabel = "Aide commande",
}: ExchangeOrderHelpSectionProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const { phone, email } = getSegnaSupportContact();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(triggerClass, placement === "header" ? "text-right whitespace-nowrap" : "text-left")}
    >
      {triggerLabel}
    </button>
  );

  const modal =
    open ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]"
          role="presentation"
          onClick={close}
        >
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "relative text-left")}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <SegnaDialogDismissButton onClick={close} />
            <h2 id={titleId} className={segnaDialogTitleClass("pr-10")}>
              Besoin d&apos;aide ?
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              Pour le suivi de ta commande, ton emprunt ou un litige, contacte l&apos;équipe Segna.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {phone ? (
                <Link href={supportTelHref(phone)} className={contactBtnClass} onClick={close}>
                  <Phone className="h-5 w-5 shrink-0 text-zinc-800" aria-hidden />
                  <span className="tabular-nums">{phone}</span>
                </Link>
              ) : null}
              {email ? (
                <Link href={`mailto:${email}`} className={contactBtnClass} onClick={close}>
                  <Mail className="h-5 w-5 shrink-0 text-zinc-800" aria-hidden />
                  <span className="min-w-0 break-all text-center">{email}</span>
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null;

  if (placement === "header") {
    return (
      <div className="shrink-0">
        {trigger}
        {modal}
      </div>
    );
  }

  return (
    <footer className="mt-3 border-0 bg-transparent px-0 pb-1 pt-0">
      {trigger}

      {modal}
    </footer>
  );
}
