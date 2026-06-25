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
  formatBorrowOverdueAppGateModalIntroFr,
  formatBorrowOverdueAppGateModalPenaltyChargePrefixFr,
  formatBorrowOverdueHeadlineFr,
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

export function BorrowOverdueAppGateModal({ gate }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!gate) return null;
  if (isBorrowOverdueGateAllowedPath(pathname, searchParams, gate)) return null;

  const headline = formatBorrowOverdueHeadlineFr(gate.lateDayIndex, {
    escalated: gate.overdueStatus === "escalated",
    formalNoticeSent: gate.formalNoticeSent,
    formalNoticeDeadlinePassed: gate.formalNoticeDeadlinePassed,
  });
  const deadlineCallout = formatBorrowOverdueAppGateModalDeadlineCallout({
    deadlineLabel: gate.nonRestitutionDeadlineLabel,
    deadlineIsProjected: gate.nonRestitutionDeadlineIsProjected,
    formalNoticeSent: gate.formalNoticeSent,
    formalNoticeDeadlinePassed: gate.formalNoticeDeadlinePassed,
    formalNoticeDeadlineLabel: gate.formalNoticeDeadlineLabel,
    cartValueCents: gate.cartValueCents,
  });
  const calloutClass =
    deadlineCallout.tone === "urgent"
      ? "border-rose-200 bg-rose-50 text-rose-950"
      : deadlineCallout.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-zinc-200 bg-zinc-50 text-zinc-800";
  const bodyClass = cn(segnaDialogBodyClass(), "font-medium text-zinc-800");

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-2xl backdrop-saturate-75"
      role="presentation"
    >
      <div
        className={cn(SEGNA_DIALOG_CARD_CLASS, "relative max-w-[min(100%,22rem)]")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="borrow-overdue-gate-title"
      >
        <div className="relative mx-auto flex w-full shrink-0 justify-center">
          <Image
            src="/ressources/segna_logo.svg"
            alt="Segna"
            width={497}
            height={204}
            className="h-8 w-auto"
          />
        </div>
        <h2
          id="borrow-overdue-gate-title"
          className={cn(segnaDialogTitleClass(), "mt-3 text-center leading-tight")}
        >
          {headline}
        </h2>
        <div className={cn(bodyClass, "mt-3 space-y-3 text-center")}>
          <p>{formatBorrowOverdueAppGateModalIntroFr(gate.lateDayIndex)}</p>
          <p>{formatBorrowOverdueAppGateModalPenaltyChargePrefixFr()}.</p>

          <div
            className={cn(
              "rounded-xl border px-3 py-3 text-left text-sm leading-snug",
              calloutClass,
            )}
          >
            <p className="font-semibold text-black">{deadlineCallout.title}</p>
            <p className="mt-1.5 text-[13px] font-normal text-black">{deadlineCallout.body}</p>
            <p
              className={cn(
                "font-normal text-black",
                deadlineCallout.inlineCgLink ? "mt-1.5 text-[13px]" : "mt-2 text-[12px]",
              )}
            >
              (
              <Link
                href={BORROW_OVERDUE_CG_LOCATION_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-600 underline decoration-blue-600 underline-offset-2"
              >
                {BORROW_OVERDUE_CG_LOCATION_LABEL_FR}
              </Link>
              )
            </p>
          </div>

          <BorrowOverdueAppGateChargeHistory
            chargeDays={gate.chargeDays}
            chargedPenaltyCents={gate.chargedPenaltyCents}
            unpaidPenaltyCents={gate.unpaidPenaltyCents}
            hasFailedCharge={gate.hasFailedCharge}
            showStripeSettlement={gate.showStripeSettlement}
            regulariserHref={gate.regulariserHref}
          />
          <p>
            {formatBorrowOverdueAppGateModalActionNoteFr({
              formalNoticeSent: gate.formalNoticeSent,
              formalNoticeDeadlinePassed: gate.formalNoticeDeadlinePassed,
            })}
          </p>
        </div>
        <div className={cn(segnaDialogMontserrat.className, "mt-5 space-y-4")}>
          <Link
            href={gate.empruntHref}
            className="flex h-12 w-full items-center justify-center rounded-full bg-zinc-900 text-[15px] font-semibold text-white transition hover:bg-zinc-800"
          >
            Retourner ma box
          </Link>
          <button
            type="button"
            onClick={openMemberFeedbackModal}
            className={cn(segnaInlineActionLinkClass, "mx-auto block text-[15px]")}
          >
            Contacter l&apos;assistance
          </button>
        </div>
      </div>
    </div>
  );
}
