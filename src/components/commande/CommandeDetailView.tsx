import Link from "next/link";

import { X } from "lucide-react";

import { CommandeExpeditionSummarySection } from "@/components/commande/CommandeExpeditionSummarySection";
import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import type { MemberCartOrderDetail, MemberCartOrderShipment } from "@/lib/cart/fetch-member-cart-order-detail";
import { getMemberOutboundShipmentPhaseCopy } from "@/lib/cart/member-outbound-shipment-copy";
import { buildMondialRelayTrackingUrl } from "@/lib/shipping/mondial-relay-tracking-url";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { ExchangeOrderHelpSection } from "@/components/exchange/ExchangeOrderHelpSection";
import { cn } from "@/lib/utils/cn";

function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

function commandeStatusTitle(d: MemberCartOrderDetail): string {
  if (d.shipment?.status) {
    return getMemberOutboundShipmentPhaseCopy(d.shipment.status).title;
  }
  return "Commande reçue";
}

function readyAnchorIso(s: MemberCartOrderShipment): string | null {
  if (s.readyAt?.trim()) return s.readyAt.trim();
  if (s.status === "ready") return s.updatedAt;
  const post = ["dropped_in", "dropped_out", "in_transit_in", "in_transit", "in_transit_out"];
  if (post.includes(s.status)) return s.updatedAt;
  return null;
}

function formatLivraisonPrevuePlus2Jours(anchorIso: string): string {
  const t = Date.parse(anchorIso);
  if (Number.isNaN(t)) return "";
  const ms = t + 2 * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

/** Sous-titre sous le statut : date prévue = passage ready + 2 jours (référence Europe/Paris pour l’affichage). */
function livraisonPrevueLine(d: MemberCartOrderDetail): string | null {
  if (!d.shipment) {
    return "La livraison prévue sera indiquée dès que ton colis est prêt à l’expédition.";
  }
  const st = d.shipment.status.toLowerCase();
  if (st === "delivered" || st === "closed") return null;
  if (st === "pending") {
    return "La livraison prévue sera indiquée dès que ton colis est prêt à l’expédition.";
  }
  const anchor = readyAnchorIso(d.shipment);
  if (!anchor) return null;
  const dateLabel = formatLivraisonPrevuePlus2Jours(anchor);
  if (!dateLabel) return null;
  return `Livraison prévue le ${dateLabel}`;
}

export function CommandeDetailView({ detail }: { detail: MemberCartOrderDetail }) {
  const headerDate = new Date(detail.createdAtIso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const creditKind = detail.walletCreditKind;
  const statusTitle = commandeStatusTitle(detail);
  const previsionLine = livraisonPrevueLine(detail);
  const mondialTrackingUrl =
    detail.shipment?.trackingNumber != null
      ? buildMondialRelayTrackingUrl(detail.shipment.trackingNumber)
      : null;

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
            Numéro de commande : {detail.orderNumberCompact}
          </h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">{headerDate}</p>
        </div>
      </header>

      <CommandeExpeditionSummarySection
        previsionLine={previsionLine}
        trackingNumber={detail.shipment?.trackingNumber ?? null}
        trackingUrl={mondialTrackingUrl}
      />

      <div className="flex flex-1 flex-col px-5 pb-4 pt-4">
        {/* Articles + total points + répartition emprunt / complément */}
        <section className="border-t border-zinc-200 pb-4 pt-2">
          <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {statusTitle}
          </h2>
          {detail.lines.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun article sur cette commande.</p>
          ) : (
            <CommandeOrderLineRows lines={detail.lines} creditKind={creditKind} />
          )}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <span className="text-[16px] font-bold text-zinc-900">Total échangé</span>
            <SegnaPointsUnitDisplay
              points={detail.totalPoints}
              creditKind={creditKind}
              numberClassName="text-[17px] font-bold text-zinc-900"
            />
          </div>
          {detail.paymentBreakdown?.creditSplit ? (
            <div className="mt-4 space-y-2.5 border-t border-zinc-100 pt-4 text-[15px] leading-snug">
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Solde d&apos;emprunt</span>
                <span className="shrink-0 font-medium text-zinc-900">
                  <SegnaPointsUnitDisplay
                    points={detail.paymentBreakdown.creditSplit.pointsFromLendingBalance}
                    creditKind={creditKind}
                    numberClassName="font-medium text-zinc-900"
                  />
                </span>
              </div>
              {detail.paymentBreakdown.creditSplit.pointsFromExchangeComplement > 0 ? (
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">Complément d&apos;échange</span>
                  <span className="shrink-0 font-medium text-zinc-900">
                    <SegnaPointsUnitDisplay
                      points={detail.paymentBreakdown.creditSplit.pointsFromExchangeComplement}
                      creditKind={creditKind}
                      numberClassName="font-medium text-zinc-900"
                    />
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* 2. Frais facturés (€ carte / livraison / service) */}
        <section className="border-b border-zinc-200 py-4">
          <h2 className={cn("mb-4 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Frais facturés
          </h2>
          {detail.paymentBreakdown?.euroDetail ? (
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
          ) : detail.paymentBreakdown ? (
            <p className="text-[13px] leading-relaxed text-zinc-500">
              Le détail en euros (frais et total carte) n&apos;est pas disponible pour cette commande.
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed text-zinc-500">
              Aucun détail de paiement carte n&apos;est disponible pour cette commande.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
