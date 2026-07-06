import Link from "next/link";

import { X } from "lucide-react";

import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import { RetourReturnPortalButton } from "@/components/retour/RetourReturnPortalButton";
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
  borrowExtensionDaysTotal?: number;
  showAvisSuccess?: boolean;
  avisSuccessCredits?: number;
  memberPostalCode?: string | null;
};

export function RetourDetailView({
  detail,
  membershipLabel,
  borrowExtensionDaysTotal = 0,
  showAvisSuccess = false,
  avisSuccessCredits = 0,
  memberPostalCode = null,
}: RetourDetailViewProps) {
  const rs = detail.returnShipment;
  const statusForCopy = rs?.status ?? "pending";
  const creditKind = detail.walletCreditKind;

  const ui = getMemberReturnPageUi(statusForCopy, {
    cartId: detail.cartId,
    orderNumberCompact: detail.orderNumberCompact,
    trackingNumber: rs?.trackingNumber ?? null,
    trackingUrl: rs?.memberTrackingUrl ?? null,
    labelUrl: rs?.labelUrl ?? null,
    updatedAtIso: rs?.updatedAt ?? null,
    outboundDeliveredAtIso: resolveOutboundBorrowDeliveredAtIso(
      detail.shipment?.deliveredAt,
      detail.shipment?.updatedAt,
    ),
    membershipLabel,
    borrowReturnDueAtIso: detail.borrowReturnDueAt,
    borrowExtensionDaysTotal,
    preprintedReturnLabel: rs?.preprintedReturnLabel ?? false,
  });

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white pb-[max(5rem,env(safe-area-inset-bottom,0px)+4.5rem)]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-4 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex w-full items-center justify-between gap-3">
            <Link
              href="/exchange"
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
              aria-label="Fermer"
            >
              <X className="h-8 w-8" strokeWidth={2.25} />
            </Link>
            <div className="-mr-1 flex min-h-12 shrink-0 items-center">
              <ExchangeOrderHelpSection placement="header" triggerLabel="Aide échange" />
            </div>
          </div>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {ui.headerTitle}
          </h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">{ui.metaLine}</p>
        </div>
      </header>

      {showAvisSuccess ? (
        <p className="mx-5 mb-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-[14px] font-medium text-emerald-900">
          {avisSuccessCredits > 0
            ? `Merci ! Tes avis sont enregistrés — ${avisSuccessCredits} crédits ajoutés à ton wallet.`
            : "Merci ! Tes avis sont enregistrés."}
        </p>
      ) : null}

      <div className="flex flex-col items-center gap-5 px-5 pb-6">
        <RetourPhaseHeroSection ui={ui} />

        {ui.showReturnPrepareButton ||
        ui.showReturnTrackingButton ||
        ui.showReturnResetButton ||
        ui.showReturnLostLabelButton ||
        ui.showReturnRelaySearchButton ? (
          <RetourReturnPortalButton
            cartId={detail.cartId}
            showPrepareButton={ui.showReturnPrepareButton}
            showTrackingButton={ui.showReturnTrackingButton}
            showResetButton={ui.showReturnResetButton ?? false}
            showLostLabelButton={ui.showReturnLostLabelButton ?? false}
            showRelaySearchButton={ui.showReturnRelaySearchButton ?? false}
            memberPostalCode={memberPostalCode}
            trackingNumber={detail.returnShipment?.trackingNumber ?? null}
            trackingUrl={detail.returnShipment?.memberTrackingUrl ?? null}
          />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-6 px-5 pb-6 pt-2">
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
