import Link from "next/link";

import { X } from "lucide-react";

import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import { RetourShippingFormClient } from "@/components/commande/RetourShippingFormClient";
import { ExchangeOrderHelpSection } from "@/components/exchange/ExchangeOrderHelpSection";
import { RetourPhaseHeroSection } from "@/components/retour/RetourPhaseHeroSection";
import type { MemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import { getMemberReturnPageUi } from "@/lib/cart/member-return-page-ui";
import { resolveOutboundBorrowDeliveredAtIso } from "@/lib/emprunt/borrow-period";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type RetourDetailViewProps = {
  detail: MemberCartOrderDetail;
  membershipLabel: MembershipLabel;
};

export function RetourDetailView({ detail, membershipLabel }: RetourDetailViewProps) {
  const rs = detail.returnShipment;
  const statusForCopy = rs?.status ?? "pending";
  const creditKind = detail.walletCreditKind;

  const ui = getMemberReturnPageUi(statusForCopy, {
    cartId: detail.cartId,
    orderNumberCompact: detail.orderNumberCompact,
    trackingNumber: rs?.trackingNumber ?? null,
    labelUrl: rs?.labelUrl ?? null,
    updatedAtIso: rs?.updatedAt ?? null,
    outboundDeliveredAtIso: resolveOutboundBorrowDeliveredAtIso(
      detail.shipment?.deliveredAt,
      detail.shipment?.updatedAt,
    ),
    membershipLabel,
  });

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white pb-[max(5rem,env(safe-area-inset-bottom,0px)+4.5rem)]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex w-full items-center justify-between gap-3">
            <Link
              href="/exchange"
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
              aria-label="Fermer"
            >
              <X className="h-8 w-8" strokeWidth={2.25} />
            </Link>
            <div className="-mr-1 flex min-h-12 shrink-0 items-center">
              <ExchangeOrderHelpSection placement="header" />
            </div>
          </div>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {ui.headerTitle}
          </h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">{ui.metaLine}</p>
        </div>
      </header>

      <RetourPhaseHeroSection ui={ui} />

      {ui.includeLabelClientBlock ? (
        <div className="flex flex-col items-center px-5 pb-2 pt-0">
          <RetourShippingFormClient
            cartId={detail.cartId}
            initialReturn={detail.returnShipment}
            showExplainer={false}
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-6 px-5 pb-6 pt-4">
        <section className="pt-2">
          <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Contenu du panier
          </h2>
          {detail.lines.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun article.</p>
          ) : (
            <CommandeOrderLineRows lines={detail.lines} creditKind={creditKind} pointsUnitDisplay="icon" />
          )}
          <div className="mt-4 flex items-center justify-between gap-3 pt-2">
            <span className="text-[16px] font-bold text-zinc-900">Total (points)</span>
            <SegnaPointsUnitDisplay
              points={detail.totalPoints}
              creditKind={creditKind}
              unitDisplay="icon"
              numberClassName="text-[17px] font-bold text-zinc-900"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
