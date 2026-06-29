"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { BorrowOverdueAppGateChargeHistory } from "@/components/emprunt/BorrowOverdueAppGateChargeHistory";
import {
  SEGNA_DIALOG_CARD_CLASS,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import {
  BORROW_OVERDUE_CG_LOCATION_HREF,
  BORROW_OVERDUE_CG_LOCATION_LABEL_FR,
  formatBorrowOverdueAppGateModalActionNoteFr,
  formatBorrowOverdueAppGateModalDeadlineCallout,
  formatBorrowOverdueAppGateModalDisputeResolutionCallout,
  formatBorrowOverdueAppGateModalIntroFr,
  formatBorrowOverdueAppGateModalInvoiceLinkLabelFr,
  formatBorrowOverdueAppGateModalPenaltyChargePrefixFr,
  formatBorrowOverdueAppGateModalPostDeadlineHeadlineFr,
  formatBorrowOverdueAppGateModalPostDeadlineIntroFr,
  formatBorrowOverdueAppGateModalRecoveryCallout,
  formatBorrowOverdueAppGateModalRecoveryOptionsFr,
  formatBorrowOverdueAppGateModalSettledHeadlineFr,
  formatBorrowOverdueAppGateModalSettledIntroFr,
  formatBorrowOverdueAppGateModalUnpaidInvoiceIntroFr,
  formatBorrowOverdueHeadlineFr,
  formatBorrowOverdueEurosFr,
} from "@/lib/cart/format-borrow-overdue-copy";
import {
  isBorrowOverdueGateAllowedPath,
  type MemberBorrowOverdueAppGate,
} from "@/lib/emprunt/fetch-member-borrow-overdue-app-gate";
import { openMemberFeedbackModal } from "@/lib/feedback/open-member-feedback-modal";
import { segnaInlineActionLinkClass } from "@/lib/ui/segna-inline-link";
import { cn } from "@/lib/utils/cn";

type Props = {
  gate: MemberBorrowOverdueAppGate | null;
};

function InvoiceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[14px] font-semibold text-blue-600 underline decoration-blue-600 underline-offset-2 sm:text-[15px]"
    >
      {formatBorrowOverdueAppGateModalInvoiceLinkLabelFr()}
    </a>
  );
}

function RecoveryOptionsList() {
  const options = formatBorrowOverdueAppGateModalRecoveryOptionsFr();
  return (
    <ol className="space-y-2 text-left text-[12px] leading-snug text-black sm:text-[13px]">
      {options.map((opt, index) => (
        <li key={opt.key} className="flex gap-2">
          <span className="shrink-0 font-semibold tabular-nums">{index + 1}.</span>
          <span>{opt.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function BorrowOverdueAppGateModal({ gate }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!gate) return null;
  if (isBorrowOverdueGateAllowedPath(pathname, searchParams, gate)) return null;

  const settled = gate.nonRestitutionSettled;
  const postDeadline = gate.postRestitutionDeadline;
  const recoveryCallout = formatBorrowOverdueAppGateModalRecoveryCallout();
  const disputeCallout = formatBorrowOverdueAppGateModalDisputeResolutionCallout();

  const headline = settled
    ? formatBorrowOverdueAppGateModalSettledHeadlineFr()
    : postDeadline
      ? formatBorrowOverdueAppGateModalPostDeadlineHeadlineFr()
      : formatBorrowOverdueHeadlineFr(gate.lateDayIndex, {
          escalated: gate.overdueStatus === "escalated",
          formalNoticeSent: gate.formalNoticeSent,
          formalNoticeDeadlinePassed: gate.formalNoticeDeadlinePassed,
        });

  const deadlineCallout = settled
    ? disputeCallout
    : postDeadline
      ? recoveryCallout
      : formatBorrowOverdueAppGateModalDeadlineCallout({
          deadlineLabel: gate.nonRestitutionDeadlineLabel,
          deadlineIsProjected: gate.nonRestitutionDeadlineIsProjected,
          formalNoticeSent: gate.formalNoticeSent,
          formalNoticeDeadlinePassed: gate.formalNoticeDeadlinePassed,
          formalNoticeDeadlineLabel: gate.formalNoticeDeadlineLabel,
          cartValueCents: gate.cartValueCents,
        });

  const calloutClass = settled
    ? "border-sky-200 bg-sky-50 text-sky-950"
    : postDeadline
      ? "border-rose-200 bg-rose-50 text-rose-950"
      : deadlineCallout.tone === "urgent"
        ? "border-rose-200 bg-rose-50 text-rose-950"
        : deadlineCallout.tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-zinc-200 bg-zinc-50 text-zinc-800";

  const bodyClass = cn(segnaDialogBodyClass(), "font-medium text-zinc-800");
  const cgLocationLink = (
    <Link
      href={BORROW_OVERDUE_CG_LOCATION_HREF}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-blue-600 underline decoration-blue-600 underline-offset-2"
    >
      {BORROW_OVERDUE_CG_LOCATION_LABEL_FR}
    </Link>
  );

  const showInvoiceLink = Boolean(gate.nonRestitutionInvoiceUrl) && (settled || gate.nonRestitutionInvoiced);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center overflow-y-auto bg-black/55 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-2xl backdrop-saturate-75 sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        className={cn(
          SEGNA_DIALOG_CARD_CLASS,
          "relative my-auto flex max-h-[min(92dvh,calc(100dvh-1.5rem))] w-full max-w-[min(100%,22rem)] flex-col overflow-hidden p-4 sm:p-5",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="borrow-overdue-gate-title"
      >
        <div className="shrink-0">
          <div className="relative mx-auto flex w-full justify-center">
            <Image
              src="/ressources/segna_logo.svg"
              alt="Segna"
              width={497}
              height={204}
              className="h-7 w-auto sm:h-8"
            />
          </div>
          <h2
            id="borrow-overdue-gate-title"
            className={cn(segnaDialogTitleClass(), "mt-2.5 text-center text-[1.05rem] leading-tight sm:mt-3 sm:text-[1.125rem]")}
          >
            {headline}
          </h2>
        </div>

        <div className={cn(bodyClass, "mt-2.5 min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain text-center sm:mt-3 sm:space-y-3")}>
          {settled ? (
            <p className="text-[14px] leading-snug sm:text-[15px]">
              {formatBorrowOverdueAppGateModalSettledIntroFr()}
              {gate.nonRestitutionInvoiceTotalCents > 0 ? (
                <>
                  {" "}
                  <span className="font-semibold">
                    ({formatBorrowOverdueEurosFr(gate.nonRestitutionInvoiceTotalCents)})
                  </span>
                </>
              ) : null}
            </p>
          ) : postDeadline ? (
            <>
              <p className="text-[14px] leading-snug sm:text-[15px]">
                {formatBorrowOverdueAppGateModalPostDeadlineIntroFr()}
              </p>
              {gate.nonRestitutionInvoiced && gate.nonRestitutionInvoiceTotalCents > 0 ? (
                <p className="text-[14px] leading-snug sm:text-[15px]">
                  {formatBorrowOverdueAppGateModalUnpaidInvoiceIntroFr(gate.nonRestitutionInvoiceTotalCents)}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-[14px] leading-snug sm:text-[15px]">
                {formatBorrowOverdueAppGateModalIntroFr(gate.lateDayIndex)}
              </p>
              <p className="text-[14px] leading-snug sm:text-[15px]">
                {formatBorrowOverdueAppGateModalPenaltyChargePrefixFr()}.
              </p>
            </>
          )}

          <div
            className={cn(
              "rounded-xl border px-3 py-2.5 text-left text-sm leading-snug sm:py-3",
              calloutClass,
            )}
          >
            <p className="font-semibold text-black">{deadlineCallout.title}</p>
            <p className="mt-1.5 text-[12px] font-normal text-black sm:text-[13px]">
              {deadlineCallout.body}
              {!postDeadline && !settled && deadlineCallout.inlineCgLink ? (
                <>
                  {" "}
                  ({cgLocationLink})
                </>
              ) : null}
            </p>
            {!postDeadline && !settled && !deadlineCallout.inlineCgLink ? (
              <p className="mt-2 text-[12px] font-normal text-black">
                ({cgLocationLink})
              </p>
            ) : null}
            {postDeadline && !settled ? (
              <div className="mt-3 border-t border-rose-200/80 pt-3">
                <RecoveryOptionsList />
              </div>
            ) : null}
          </div>

          {showInvoiceLink && gate.nonRestitutionInvoiceUrl ? (
            <InvoiceLink href={gate.nonRestitutionInvoiceUrl} />
          ) : null}

          {!postDeadline && !settled ? (
            <>
              <BorrowOverdueAppGateChargeHistory
                chargeDays={gate.chargeDays}
                chargedPenaltyCents={gate.chargedPenaltyCents}
                unpaidPenaltyCents={gate.unpaidPenaltyCents}
                hasFailedCharge={gate.hasFailedCharge}
                showStripeSettlement={gate.showStripeSettlement}
                regulariserHref={gate.regulariserHref}
              />
              <p className="text-[14px] leading-snug sm:text-[15px]">
                {formatBorrowOverdueAppGateModalActionNoteFr({
                  formalNoticeSent: gate.formalNoticeSent,
                  formalNoticeDeadlinePassed: gate.formalNoticeDeadlinePassed,
                })}
              </p>
            </>
          ) : settled ? (
            <p className="text-[14px] leading-snug text-zinc-600 sm:text-[15px]">
              Tu peux encore déposer ton colis au relais ; en cas de retour après règlement, la
              valeur du panier pourra être remboursée selon nos conditions.
            </p>
          ) : null}
        </div>

        <div className={cn(segnaDialogMontserrat.className, "mt-3 shrink-0 space-y-3 border-t border-zinc-100 pt-3 sm:mt-4 sm:space-y-4 sm:pt-4")}>
          <Link
            href={gate.empruntHref}
            className="flex h-11 w-full items-center justify-center rounded-full bg-zinc-900 text-[14px] font-semibold text-white transition hover:bg-zinc-800 sm:h-12 sm:text-[15px]"
          >
            Retourner ma box
          </Link>
          <button
            type="button"
            onClick={openMemberFeedbackModal}
            className={cn(segnaInlineActionLinkClass, "mx-auto block text-[14px] sm:text-[15px]")}
          >
            Contacter l&apos;assistance
          </button>
        </div>
      </div>
    </div>
  );
}
