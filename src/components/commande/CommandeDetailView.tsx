import Link from "next/link";

import { X } from "lucide-react";

import {
  CommandeCancelOrderButton,
  type CommandeCancelStripeEuroLines,
} from "@/components/commande/CommandeCancelOrderButton";
import {
  CommandeExpeditionSummarySection,
  type CommandeUberPhases,
} from "@/components/commande/CommandeExpeditionSummarySection";
import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import type { MemberCartOrderDetail, MemberCartOrderShipment } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  checkoutPaymentIndicatesUberDirect,
  isUberCartOutboundShipment,
} from "@/lib/cart/cart-outbound-delivery-kind";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";
import { SEGNA_OUTBOUND_PREP_ESTIMATE_MINUTES } from "@/lib/uber-direct/segna-prep-estimate";
import {
  getMemberOutboundShipmentPhaseCopy,
  normalizeOutboundShipmentStatusForUi,
} from "@/lib/cart/member-outbound-shipment-copy";
import { getSegnaSupportContact } from "@/lib/config/support-contact";
import { buildMondialRelayTrackingUrl } from "@/lib/shipping/mondial-relay-tracking-url";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { ExchangeOrderHelpSection } from "@/components/exchange/ExchangeOrderHelpSection";
import { cn } from "@/lib/utils/cn";

function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

function formatDateTimeFr(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

function commandeStatusTitle(d: MemberCartOrderDetail): string {
  if (d.cartStatus === "canceled") return "Commande annulée";
  if (d.shipment?.status) {
    return getMemberOutboundShipmentPhaseCopy(d.shipment.status).title;
  }
  return "Commande reçue";
}

function readyAnchorIso(s: MemberCartOrderShipment): string | null {
  if (s.readyAt?.trim()) return s.readyAt.trim();
  if (s.status === "ready") return s.updatedAt;
  const post = ["dropped_in", "dropped_out", "in_transit_in", "in_transit_out"];
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
  if (d.cartStatus === "canceled") return null;
  const isUberOutbound =
    isUberCartOutboundShipment(d.shipment) ||
    checkoutPaymentIndicatesUberDirect(d.paymentBreakdown?.euroDetail);
  if (!d.shipment) {
    return "Ton colis est en préparation ; tu recevras des détails sur le suivi du colis.";
  }
  const st = d.shipment.status.toLowerCase();
  if (st === "delivered" || st === "closed") return null;
  if (st === "pending") {
    if (isUberOutbound) {
      return null;
    }
    return "Ton colis est en préparation ; tu recevras des détails sur le suivi du colis.";
  }
  const anchor = readyAnchorIso(d.shipment);
  if (!anchor) return null;
  const dateLabel = formatLivraisonPrevuePlus2Jours(anchor);
  if (!dateLabel) return null;
  return `Livraison prévue le ${dateLabel}`;
}

function buildCommandeUberPhases(detail: MemberCartOrderDetail): CommandeUberPhases | null {
  const isUber =
    isUberCartOutboundShipment(detail.shipment) ||
    checkoutPaymentIndicatesUberDirect(detail.paymentBreakdown?.euroDetail);
  if (!isUber || !detail.shipment) return null;

  const st = normalizeOutboundShipmentStatusForUi(detail.shipment.status);
  const prep = `Colis en préparation (${SEGNA_OUTBOUND_PREP_ESTIMATE_MINUTES} min env. après la commande).`;

  if (st === "delivered" || st === "closed") {
    return { preparationLine: "Livraison effectuée.", deliveryWindowLine: null };
  }

  if (st === "in_transit_in") {
    return {
      preparationLine: "Ton colis est en chemin vers toi.",
      deliveryWindowLine: null,
      inTransit: true,
    };
  }

  if (st === "pending") {
    return { preparationLine: prep, deliveryWindowLine: null };
  }

  if (st === "ready") {
    return {
      preparationLine: "Votre box est prête, le coursier Uber va bientôt la récupérer.",
      deliveryWindowLine: null,
    };
  }

  return { preparationLine: prep, deliveryWindowLine: null };
}

export function CommandeDetailView({
  detail,
  membershipLabel,
  returnDeadlineMs,
}: {
  detail: MemberCartOrderDetail;
  membershipLabel: MembershipLabel;
  returnDeadlineMs: number | null;
}) {
  const headerDate = new Date(detail.createdAtIso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const creditKind = detail.walletCreditKind;
  const statusTitle = commandeStatusTitle(detail);
  const previsionLine = livraisonPrevueLine(detail);
  const isUberOutbound =
    isUberCartOutboundShipment(detail.shipment) ||
    checkoutPaymentIndicatesUberDirect(detail.paymentBreakdown?.euroDetail);
  const mondialTrackingUrl =
    !isUberOutbound && detail.shipment?.trackingNumber != null
      ? buildMondialRelayTrackingUrl(detail.shipment.trackingNumber)
      : null;
  const uberTrackingHref = isUberOutbound ? (detail.shipment?.memberTrackingUrl ?? null) : null;
  const uberPhases = isUberOutbound ? buildCommandeUberPhases(detail) : null;
  const supportEmail = getSegnaSupportContact().email ?? "contact@segnashare.com";
  const shipSt = detail.shipment?.status
    ? normalizeOutboundShipmentStatusForUi(detail.shipment.status)
    : "";
  /** Tant que l’aller MR est « en préparation », pas de lien / libellé suivi côté membre. */
  const hideMondialTrackingWhilePending = !isUberOutbound && shipSt === "pending";
  const expeditionTrackingRef = hideMondialTrackingWhilePending ? null : (detail.shipment?.trackingNumber ?? null);
  const expeditionTrackingHref = hideMondialTrackingWhilePending
    ? null
    : isUberOutbound
      ? uberTrackingHref
      : mondialTrackingUrl;
  const isDelivered = shipSt === "delivered";
  const rentalDurationLabel = membershipLabel === "Guest" ? "10 jours de location" : "1 mois de location";
  const hasReturnDeadline = returnDeadlineMs != null && Number.isFinite(returnDeadlineMs);
  const returnDeadlineLabel = hasReturnDeadline ? formatDateTimeFr(returnDeadlineMs) : null;

  const euro = detail.paymentBreakdown?.euroDetail ?? null;
  const showFraisFactures =
    euro != null &&
    (euro.totalPaidEuros > 0.005 ||
      euro.complementCreditsEuros > 0.005 ||
      euro.serviceFeeEuros > 0.005 ||
      euro.shippingFeeEuros > 0.005);

  const cancelStripeEuroLines: CommandeCancelStripeEuroLines | null =
    euro && euro.totalPaidEuros > 0.005
      ? {
          complementCreditsEuros: euro.complementCreditsEuros,
          serviceFeeEuros: euro.serviceFeeEuros,
          shippingFeeEuros: euro.shippingFeeEuros,
          totalPaidEuros: euro.totalPaidEuros,
          ...(euro.feesVatEuros != null && euro.feesVatEuros > 0.005 ? { feesVatEuros: euro.feesVatEuros } : {}),
        }
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

      {detail.cartStatus === "canceled" ? (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-[14px] leading-snug text-amber-950">
          Cette commande a été annulée. Les crédits prélevés ont été recrédités sur ton wallet
          {cancelStripeEuroLines ? (
            <>
              , le paiement carte remboursé après retenue de 20&nbsp;% (frais d&apos;annulation sur le montant
              encaissé par carte)
            </>
          ) : null}
          , et les pièces sont de nouveau disponibles à l&apos;achat.
        </div>
      ) : null}

      <CommandeExpeditionSummarySection
        variant={isUberOutbound ? "uber" : "mondial"}
        previsionLine={previsionLine}
        trackingRef={expeditionTrackingRef}
        trackingHref={expeditionTrackingHref}
        uberPhases={uberPhases}
      />

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-3">
        {/* Pas de border-t ici : le bloc expédition a déjà border-b (évite double trait). */}
        <section className="pb-4 pt-2">
          <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {statusTitle}
          </h2>
          {isDelivered ? (
            <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3.5 text-left">
              <p className="text-[14px] leading-snug text-zinc-800">
                Durée de location : <span className="font-semibold text-zinc-900">{rentalDurationLabel}</span>
                {returnDeadlineLabel ? (
                  <>
                    {" "}
                    · date limite de retour : <span className="font-semibold text-zinc-900">{returnDeadlineLabel}</span>
                  </>
                ) : null}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
                <Link href={`/exchange/retour/${detail.cartId}`} className="text-zinc-700 underline underline-offset-2">
                  Préparer mon retour
                </Link>
                <Link href={`mailto:${supportEmail}`} className="text-zinc-500 underline underline-offset-2">
                  Déclarer un problème
                </Link>
              </div>
            </div>
          ) : null}
          {detail.lines.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun article sur cette commande.</p>
          ) : (
            <CommandeOrderLineRows lines={detail.lines} creditKind={creditKind} pointsUnitDisplay="icon" />
          )}
          <div className="mt-4 flex items-center justify-between gap-3 pt-2">
            <span className="text-[16px] font-bold text-zinc-900">Total échangé</span>
            <SegnaPointsUnitDisplay
              points={detail.totalPoints}
              creditKind={creditKind}
              unitDisplay="icon"
              numberClassName="text-[17px] font-bold text-zinc-900"
            />
          </div>
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
        </section>

        {/* Frais facturés (€) — uniquement s’il existe un montant € facturé (pas de bloc vide / explainer). */}
        {showFraisFactures && euro ? (
          <section className="border-b border-zinc-200 py-4">
            <h2 className={cn("mb-4 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              Frais facturés
            </h2>
            <div className="space-y-2.5 text-[15px] leading-snug">
              {euro.complementCreditsEuros > 0 ? (
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">Complément d&apos;échange (TTC)</span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {formatEuros(euro.complementCreditsEuros)}
                  </span>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Frais de service (TTC)</span>
                <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                  {formatEuros(euro.serviceFeeEuros)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Frais de livraison (TTC)</span>
                <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                  {formatEuros(euro.shippingFeeEuros)}
                </span>
              </div>
              {euro.feesVatEuros != null && euro.feesVatEuros > 0 ? (
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">dont TVA</span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {formatEuros(euro.feesVatEuros)}
                  </span>
                </div>
              ) : null}
              <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-4">
                <span className="text-[17px] font-bold text-zinc-900">Sous-total facturé</span>
                <span className="text-[18px] font-bold tabular-nums text-zinc-900">
                  {formatEuros(euro.totalPaidEuros)}
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {detail.cartStatus !== "canceled" ? (
          <CommandeCancelOrderButton
            cartId={detail.cartId}
            cancellation={detail.orderCancellation}
            stripeEuroLines={cancelStripeEuroLines}
            wrapClassName="mt-6 flex flex-col items-center gap-2 pb-[max(1.25rem,env(safe-area-inset-bottom,0px)+0.75rem)] pt-2"
          />
        ) : null}
      </div>
    </main>
  );
}
