"use client";

import Link from "next/link";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type Props = {
  open: boolean;
  itemId: string;
  recoveryLabel: string;
  recoveryHref: string;
  recoveryStage: string;
  canCancelReturn: boolean;
  canMemberConfirmRecovery: boolean;
  canMemberReportIssue: boolean;
  recoveryError: string | null;
  recoverySubmitting: boolean;
  onDismiss: () => void;
  onConfirmClick: () => void;
  onHelpClick: () => void;
};

export function ItemRecoveryStatusModal({
  open,
  itemId,
  recoveryLabel,
  recoveryHref,
  recoveryStage,
  canCancelReturn,
  canMemberConfirmRecovery,
  canMemberReportIssue,
  recoveryError,
  recoverySubmitting,
  onDismiss,
  onConfirmClick,
  onHelpClick,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      onClick={onDismiss}
    >
      <div
        className={cn(SEGNA_DIALOG_CARD_CLASS, "relative max-w-[400px]")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-recovery-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <SegnaDialogDismissButton onClick={onDismiss} />
        <h2 id="item-recovery-modal-title" className={segnaDialogTitleClass("pr-10 text-[20px] sm:text-[22px]")}>
          Ta pièce est en récupération
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-2")}>
          État actuel : <span className="font-semibold text-zinc-900">{recoveryLabel}</span>.
        </p>
        {canMemberConfirmRecovery ? (
          <p className={cn(segnaDialogBodyClass(), "mt-2")}>
            Vérifie le contenu reçu puis confirme que la récupération est conforme.
          </p>
        ) : null}
        {recoveryStage === "member_issue_reported" ? (
          <p className={cn(montserrat.className, "mt-2 text-[14px] leading-relaxed text-rose-700")}>
            Litige signalé. L&apos;équipe Segna va revenir vers toi rapidement.
          </p>
        ) : null}
        {recoveryError ? (
          <p className={cn(montserrat.className, "mt-2 text-[14px] text-rose-700")}>{recoveryError}</p>
        ) : null}

        <div className="mt-4 grid gap-2">
          {canMemberConfirmRecovery ? (
            <>
              <p className={cn(segnaDialogBodyClass(), "text-zinc-700")}>As-tu bien récupéré ta pièce ?</p>
              <button
                type="button"
                onClick={onConfirmClick}
                disabled={recoverySubmitting}
                className={cn(
                  montserrat.className,
                  "flex h-10 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60",
                )}
              >
                Valider la récupération
              </button>
              {canMemberReportIssue ? (
                <button
                  type="button"
                  onClick={onHelpClick}
                  disabled={recoverySubmitting}
                  className={cn(
                    montserrat.className,
                    "h-10 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-800 disabled:opacity-60",
                  )}
                >
                  Aide litige
                </button>
              ) : null}
            </>
          ) : (
            <>
              {canCancelReturn ? (
                <form action="/api/items/outtake/cancel" method="post" className="contents">
                  <input type="hidden" name="item_id" value={itemId} />
                  <button
                    type="submit"
                    disabled={recoverySubmitting}
                    className={cn(
                      montserrat.className,
                      "h-10 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-800 disabled:opacity-60",
                    )}
                  >
                    Annuler le renvoi
                  </button>
                </form>
              ) : null}
              <Link
                href={recoveryHref}
                onClick={onDismiss}
                className={cn(
                  montserrat.className,
                  "flex h-10 items-center justify-center rounded-lg bg-zinc-900 text-center text-sm font-semibold text-white",
                )}
              >
                Suivre le renvoi
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
