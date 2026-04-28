import Link from "next/link";

import { X } from "lucide-react";

import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import { EmpruntBorrowSummarySection } from "@/components/emprunt/EmpruntBorrowSummarySection";
import { EmpruntBorrowCountdown } from "@/components/emprunt/EmpruntBorrowCountdown";
import type { MemberCartOrderDetail } from "@/lib/cart/fetch-member-cart-order-detail";
import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import type { SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { ExchangeOrderHelpSection } from "@/components/exchange/ExchangeOrderHelpSection";
import { cn } from "@/lib/utils/cn";

type EmpruntDetailViewProps = {
  detail: MemberCartOrderDetail;
  membershipLabel: SegnaBorrowMembershipLabel;
};

function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

/**
 * Panier « chez le membre » après livraison aller — durée de location & retour (placeholders).
 */
export function EmpruntDetailView({ detail, membershipLabel }: EmpruntDetailViewProps) {
  const creditKind = detail.walletCreditKind;
  const returnCommitmentMet = isCartReturnCommitmentMet(detail.returnShipment?.status);

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
            Emprunt en cours
          </h1>
          {detail.shipment?.updatedAt ? (
            <EmpruntBorrowCountdown
              deliveredAtIso={detail.shipment.updatedAt}
              orderNumberCompact={detail.orderNumberCompact}
              membershipLabel={membershipLabel}
            />
          ) : (
            <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">
              Commande {detail.orderNumberCompact} — pièces livrées chez toi
            </p>
          )}
        </div>
      </header>

      <EmpruntBorrowSummarySection
        cartId={detail.cartId}
        deliveredAtIso={detail.shipment?.updatedAt ?? null}
        returnCommitmentMet={returnCommitmentMet}
        membershipLabel={membershipLabel}
      />

      <div className="flex flex-1 flex-col gap-6 px-5 pb-6 pt-4">
        {/* Pas de border-t : EmpruntBorrowSummarySection a déjà border-b (évite double trait). */}
        <section className="pt-2">
          <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Pièces empruntées
          </h2>
          {detail.lines.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun article.</p>
          ) : (
            <CommandeOrderLineRows lines={detail.lines} creditKind={creditKind} pointsUnitDisplay="icon" />
          )}
          <div className="mt-4 flex items-center justify-between gap-3 pt-2">
            <span className="text-[16px] font-bold text-zinc-900">Total emprunté</span>
            <SegnaPointsUnitDisplay
              points={detail.totalPoints}
              creditKind={creditKind}
              unitDisplay="icon"
              numberClassName="text-[17px] font-bold text-zinc-900"
            />
          </div>
          {detail.pointsPaidSplit &&
          (detail.pointsPaidSplit.exchangePoints > 0 || detail.pointsPaidSplit.consumptionPoints > 0) ? (
            <div className="mt-3 space-y-2 text-[14px] leading-snug text-zinc-600">
              {detail.pointsPaidSplit.exchangePoints > 0 ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 pr-2">Crédits d&apos;échange</span>
                  <SegnaPointsUnitDisplay
                    points={detail.pointsPaidSplit.exchangePoints}
                    creditKind="exchange"
                    unitDisplay="icon"
                    numberClassName="font-medium text-zinc-900"
                  />
                </div>
              ) : null}
              {detail.pointsPaidSplit.consumptionPoints > 0 ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 pr-2">Crédits de consommation</span>
                  <SegnaPointsUnitDisplay
                    points={detail.pointsPaidSplit.consumptionPoints}
                    creditKind="consumption"
                    unitDisplay="icon"
                    numberClassName="font-medium text-zinc-900"
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {detail.paymentBreakdown?.creditSplit &&
          detail.paymentBreakdown.creditSplit.pointsFromExchangeComplement > 0 ? (
            <div className="mt-3 space-y-2.5 text-[15px] leading-snug">
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Complément d&apos;échange</span>
                <span className="shrink-0 font-medium text-zinc-900">
                  <SegnaPointsUnitDisplay
                    points={detail.paymentBreakdown.creditSplit.pointsFromExchangeComplement}
                    creditKind={creditKind}
                    unitDisplay="icon"
                    numberClassName="font-medium text-zinc-900"
                  />
                </span>
              </div>
            </div>
          ) : null}
        </section>

        {detail.paymentBreakdown?.euroDetail ? (
          <section className="border-b border-zinc-200 py-4">
            <h2 className={cn("mb-4 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              Frais facturés
            </h2>
            <div className="space-y-2.5 text-[15px] leading-snug">
              {detail.paymentBreakdown.euroDetail.complementCreditsEuros > 0 ? (
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">Complément d&apos;échange (TTC)</span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {formatEuros(detail.paymentBreakdown.euroDetail.complementCreditsEuros)}
                  </span>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Frais de service (TTC)</span>
                <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                  {formatEuros(detail.paymentBreakdown.euroDetail.serviceFeeEuros)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Frais de livraison (TTC)</span>
                <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                  {formatEuros(detail.paymentBreakdown.euroDetail.shippingFeeEuros)}
                </span>
              </div>
              {detail.paymentBreakdown.euroDetail.feesVatEuros != null &&
              detail.paymentBreakdown.euroDetail.feesVatEuros > 0 ? (
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">dont TVA</span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {formatEuros(detail.paymentBreakdown.euroDetail.feesVatEuros)}
                  </span>
                </div>
              ) : null}
              <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-4">
                <span className="text-[17px] font-bold text-zinc-900">Sous-total facturé</span>
                <span className="text-[18px] font-bold tabular-nums text-zinc-900">
                  {formatEuros(detail.paymentBreakdown.euroDetail.totalPaidEuros)}
                </span>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
