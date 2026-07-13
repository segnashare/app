import Link from "next/link";

import { X } from "lucide-react";

import {
  CommandeCancelOrderButton,
  type CommandeCancelStripeEuroLines,
} from "@/components/commande/CommandeCancelOrderButton";
import { CommandeCanceledNoticeModal } from "@/components/commande/CommandeCanceledNoticeModal";
import {
  CommandeExpeditionSummarySection,
  type CommandeUberPhases,
} from "@/components/commande/CommandeExpeditionSummarySection";
import { CommandeReceptionExchangeSection } from "@/components/commande/CommandeReceptionExchangeSection";
import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import type { MemberCartOrderDetail, MemberCartOrderShipment } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  checkoutPaymentIndicatesUberDirect,
  isCartOutboundCoursier,
  isUberCartOutboundShipment,
} from "@/lib/cart/cart-outbound-delivery-kind";
import { formatCartBorrowRentalDurationLabel } from "@/lib/emprunt/borrow-period";
import {
  isOutboundDeliveredForReceipt,
  memberReceiptAnchorFromOrderShipment,
  memberReceiptAutoConfirmEligibleAtMs,
} from "@/lib/cart/member-receipt-validation";
import { formatDateTimeParis, formatLongDateParis } from "@/lib/datetime/segna-datetime";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";
import { SEGNA_OUTBOUND_PREP_ESTIMATE_MINUTES } from "@/lib/uber-direct/segna-prep-estimate";
import {
  getMemberOutboundShipmentPhaseCopy,
  normalizeOutboundShipmentStatusForUi,
} from "@/lib/cart/member-outbound-shipment-copy";
import { buildMondialRelayTrackingUrl } from "@/lib/shipping/mondial-relay-tracking-url";
import {
  isGuestCashRentalOrderDisplay,
  resolveGuestOrderPurchaseEuros,
  resolveGuestOrderRentalEuros,
} from "@/lib/billing/guest-rental-pricing";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { ExchangeOrderHelpSection } from "@/components/exchange/ExchangeOrderHelpSection";
import { cn } from "@/lib/utils/cn";

function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
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
  return formatLongDateParis(ms);
}

/** Sous-titre sous le statut : date prévue = passage ready + 2 jours (référence Europe/Paris pour l’affichage). */
function livraisonPrevueLine(d: MemberCartOrderDetail): string | null {
  if (d.cartStatus === "canceled") return null;
  const isCoursierOutbound = isCartOutboundCoursier(d.shipment);
  const isUberOutbound =
    !isCoursierOutbound &&
    (isUberCartOutboundShipment(d.shipment) ||
      checkoutPaymentIndicatesUberDirect(d.paymentBreakdown?.euroDetail));
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
  const isCoursier = isCartOutboundCoursier(detail.shipment);
  const isUber =
    !isCoursier &&
    (isUberCartOutboundShipment(detail.shipment) ||
      checkoutPaymentIndicatesUberDirect(detail.paymentBreakdown?.euroDetail));
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
      preparationLine: "Votre box est prête, un coursier Coursier.fr va bientôt la récupérer.",
      deliveryWindowLine: null,
    };
  }

  return { preparationLine: prep, deliveryWindowLine: null };
}

export function CommandeDetailView({
  detail,
  membershipLabel,
}: {
  detail: MemberCartOrderDetail;
  membershipLabel: MembershipLabel;
}) {
  const headerDate = formatDateTimeParis(detail.createdAtIso);
  const creditKind = detail.walletCreditKind;
  const previsionLine = livraisonPrevueLine(detail);
  const isCoursierOutbound = isCartOutboundCoursier(detail.shipment);
  const isUberOutbound =
    !isCoursierOutbound &&
    (isUberCartOutboundShipment(detail.shipment) ||
      checkoutPaymentIndicatesUberDirect(detail.paymentBreakdown?.euroDetail));
  const mondialTrackingUrl =
    !isUberOutbound && detail.shipment?.trackingNumber != null
      ? buildMondialRelayTrackingUrl(detail.shipment.trackingNumber)
      : null;
  const uberTrackingHref = isUberOutbound ? (detail.shipment?.memberTrackingUrl ?? null) : null;
  const uberPhases = isUberOutbound ? buildCommandeUberPhases(detail) : null;
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
  const isPurchaseOrder = detail.isPurchaseOrder;
  const showReceptionExchange =
    isDelivered && detail.cartStatus !== "canceled" && !isPurchaseOrder;
  const statusTitle = showReceptionExchange ? "Contenu de la box" : commandeStatusTitle(detail);
  const receiptConfirmed = Boolean(detail.memberReceiptConfirmedAt?.trim());
  const receiptAnchor = memberReceiptAnchorFromOrderShipment(detail.shipment);
  const autoConfirmEligibleAtIso = (() => {
    if (receiptConfirmed || !receiptAnchor || !isOutboundDeliveredForReceipt(receiptAnchor)) return null;
    const eligibleMs = memberReceiptAutoConfirmEligibleAtMs(receiptAnchor);
    return Number.isFinite(eligibleMs) ? new Date(eligibleMs).toISOString() : null;
  })();
  const rentalDurationLabel = formatCartBorrowRentalDurationLabel(
    detail.checkoutBorrowDurationDays,
    membershipLabel,
  );
  const guestCashRental = isGuestCashRentalOrderDisplay(membershipLabel, detail);
  const guestRentalEuros = guestCashRental && !isPurchaseOrder ? resolveGuestOrderRentalEuros(detail) : 0;
  const guestPurchaseEuros = guestCashRental && isPurchaseOrder ? resolveGuestOrderPurchaseEuros(detail) : 0;

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
            {showReceptionExchange && !receiptConfirmed ? (
              <div className="h-12 w-12 shrink-0" aria-hidden />
            ) : (
              <Link
                href="/exchange"
                className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
                aria-label="Fermer"
              >
                <X className="h-8 w-8" strokeWidth={2.25} />
              </Link>
            )}
            <div className="-mr-1 flex min-h-12 shrink-0 items-center">
              <ExchangeOrderHelpSection placement="header" />
            </div>
          </div>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Commande {detail.orderNumberCompact}
          </h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">{headerDate}</p>
        </div>
      </header>

      {detail.cartStatus === "canceled" ? (
        <CommandeCanceledNoticeModal cartId={detail.cartId} hasStripeRefund={cancelStripeEuroLines != null} />
      ) : null}

      {showReceptionExchange ? (
        <CommandeReceptionExchangeSection
          cartId={detail.cartId}
          rentalDurationLabel={rentalDurationLabel}
          receiptAlreadyConfirmed={receiptConfirmed}
          autoConfirmEligibleAtIso={autoConfirmEligibleAtIso}
        />
      ) : (
        <CommandeExpeditionSummarySection
          variant={isUberOutbound ? "uber" : "mondial"}
          previsionLine={previsionLine}
          trackingRef={expeditionTrackingRef}
          trackingHref={expeditionTrackingHref}
          uberPhases={uberPhases}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-3">
        {/* Pas de border-t ici : le bloc expédition a déjà border-b (évite double trait). */}
        <section className="pb-4 pt-2">
          <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {statusTitle}
          </h2>
          {detail.lines.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun article sur cette commande.</p>
          ) : (
            <CommandeOrderLineRows
              lines={detail.lines}
              creditKind={creditKind}
              pointsUnitDisplay="icon"
              guestCashRental={guestCashRental}
              guestPurchaseMode={isPurchaseOrder}
            />
          )}
          <div className="mt-4 flex items-center justify-between gap-3 pt-2">
            <span className="text-[16px] font-bold text-zinc-900">
              {guestCashRental
                ? isPurchaseOrder
                  ? "Prix d'achat"
                  : "Prix de location"
                : "Total échangé"}
            </span>
            {guestCashRental ? (
              <span className="text-[17px] font-bold tabular-nums text-zinc-900">
                {formatEuros(isPurchaseOrder ? guestPurchaseEuros : guestRentalEuros)}
              </span>
            ) : (
              <SegnaPointsUnitDisplay
                points={detail.totalPoints}
                creditKind={creditKind}
                unitDisplay="icon"
                numberClassName="text-[17px] font-bold text-zinc-900"
              />
            )}
          </div>
          {!guestCashRental &&
          detail.paymentBreakdown?.creditSplit &&
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

        {/* Frais facturés (€) — uniquement s’il existe un montant € facturé (pas de bloc vide / explainer). */}
        {showFraisFactures && euro ? (
          <section className="border-b border-zinc-200 py-4">
            <h2 className={cn("mb-4 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              Frais facturés
            </h2>
            <div className="space-y-2.5 text-[15px] leading-snug">
              {euro.complementCreditsEuros > 0 ? (
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">
                    {guestCashRental
                      ? isPurchaseOrder
                        ? "Prix d'achat (TTC)"
                        : "Prix de location (TTC)"
                      : "Complément d&apos;échange (TTC)"}
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {formatEuros(euro.complementCreditsEuros)}
                  </span>
                </div>
              ) : null}
              {euro.serviceFeeEuros > 0.005 ? (
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">Frais de service (TTC)</span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {formatEuros(euro.serviceFeeEuros)}
                  </span>
                </div>
              ) : null}
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
                <span className="text-[17px] font-bold text-zinc-900">Sous-total (TTC)</span>
                <span className="text-[18px] font-bold tabular-nums text-zinc-900">
                  {formatEuros(euro.totalPaidEuros)}
                </span>
              </div>
              {detail.stripeInvoiceDownloadUrl ? (
                <p className="mt-4 text-center">
                  <a
                    href={detail.stripeInvoiceDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[15px] font-semibold text-blue-600 underline underline-offset-2"
                  >
                    Télécharger la facture (PDF)
                  </a>
                </p>
              ) : null}
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
