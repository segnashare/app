"use client";

import Link from "next/link";

import { buildIntakeShippingPageHrefFromIds } from "@/lib/items/intake-cart-return-piggyback";
import {
  INTAKE_PENDING_SHIPPING_GATE_MESSAGES,
  type IntakePendingShippingGatePurpose,
} from "@/lib/items/member-intake-shipping-pipeline-gate";
import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

type IntakePendingShippingGateModalProps = {
  open: boolean;
  onClose: () => void;
  purpose: IntakePendingShippingGatePurpose;
  pendingItemIds: string[];
  shipmentsSplit?: boolean;
};

export function IntakePendingShippingGateModal({
  open,
  onClose,
  purpose,
  pendingItemIds,
  shipmentsSplit = false,
}: IntakePendingShippingGateModalProps) {
  if (!open) return null;

  const copy = INTAKE_PENDING_SHIPPING_GATE_MESSAGES[purpose];
  const showPrepareShippingCta = pendingItemIds.length >= 2 && !shipmentsSplit;
  const shippingHref = buildIntakeShippingPageHrefFromIds(pendingItemIds);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
      <div
        className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-pending-shipping-gate-title"
      >
        <SegnaDialogDismissButton onClick={onClose} />
        <h2 id="intake-pending-shipping-gate-title" className={segnaDialogTitleClass("pr-10 text-[20px] sm:text-[22px]")}>
          {copy.title}
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-2")}>{copy.body}</p>
        <div className={cn("mt-4 grid gap-2", showPrepareShippingCta ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-800"
          >
            Fermer
          </button>
          {showPrepareShippingCta ? (
            <Link
              href={shippingHref}
              onClick={onClose}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white"
            >
              Préparer mon envoi
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
