"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SEGNA_DIALOG_CARD_CLASS,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import type { MemberReceiptPendingGatePayload } from "@/lib/cart/fetch-member-pending-receipt-gate";
import { isMemberReceiptCommandeFlowPath } from "@/lib/cart/fetch-member-pending-receipt-gate";
import { cn } from "@/lib/utils/cn";

type Props = {
  gate: MemberReceiptPendingGatePayload | null;
};

export function MemberReceiptPendingGateModal({ gate }: Props) {
  const pathname = usePathname();

  if (!gate) return null;
  if (isMemberReceiptCommandeFlowPath(pathname, gate.cartId)) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-2xl backdrop-saturate-75"
      role="presentation"
    >
      <div
        className={cn(SEGNA_DIALOG_CARD_CLASS, "relative max-w-[min(100%,22rem)]")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-receipt-gate-title"
      >
        <div className="relative mx-auto flex w-full justify-center shrink-0">
          <Image
            src="/ressources/segna_logo.svg"
            alt="Segna"
            width={497}
            height={204}
            className="h-8 w-auto"
          />
        </div>
        <h2 id="member-receipt-gate-title" className={cn(segnaDialogTitleClass(), "mt-4 text-center")}>
          Ta commande est arrivée
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-3 text-center font-medium text-zinc-800")}>
          Vérifie le contenu de ta box sur la page commande, puis valide la bonne réception ou signale un
          problème avant de continuer sur Segna.
        </p>
        <div className={cn(segnaDialogMontserrat.className, "mt-5")}>
          <Link
            href={`/commande/${gate.cartId}`}
            className="flex h-12 w-full items-center justify-center rounded-full bg-zinc-900 text-[15px] font-semibold text-white transition hover:bg-zinc-800"
          >
            Voir ma commande {gate.orderNumberCompact}
          </Link>
        </div>
      </div>
    </div>
  );
}
