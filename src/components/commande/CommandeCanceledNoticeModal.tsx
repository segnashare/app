"use client";

import { useCallback, useEffect, useState } from "react";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

function sessionDismissKey(cartId: string): string {
  return `segna:cart-canceled-notice:${cartId}`;
}

type Props = {
  cartId: string;
  hasStripeRefund: boolean;
};

export function CommandeCanceledNoticeModal({ cartId, hasStripeRefund }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(sessionDismissKey(cartId)) === "1") return;
    } catch {
      /* sessionStorage indisponible */
    }
    setOpen(true);
  }, [cartId]);

  const dismiss = useCallback(() => {
    try {
      window.sessionStorage.setItem(sessionDismissKey(cartId), "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, [cartId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-2xl backdrop-saturate-75"
      role="presentation"
      onClick={dismiss}
    >
      <div
        className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="commande-canceled-notice-title"
        onClick={(e) => e.stopPropagation()}
      >
        <SegnaDialogDismissButton variant="overlay" onClick={dismiss} aria-label="Fermer" />
        <h2 id="commande-canceled-notice-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
          Commande annulée
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-3 font-medium text-zinc-800")}>
          Cette commande a été annulée. Les crédits prélevés ont été recrédités sur ton wallet
          {hasStripeRefund ? (
            <>
              , le paiement carte remboursé après retenue de 20&nbsp;% (frais d&apos;annulation sur le montant
              encaissé par carte)
            </>
          ) : null}
          , et les pièces sont de nouveau disponibles à l&apos;achat.
        </p>
        <div className={cn(segnaDialogMontserrat.className, "mt-5")}>
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800"
          >
            J&apos;ai compris
          </button>
        </div>
      </div>
    </div>
  );
}
