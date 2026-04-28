"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { OutboundShipmentSummary } from "@/lib/cart/fetch-outbound-shipment-summary";
import {
  checkoutMetaIndicatesUberDirect,
  isUberCartOutboundShipment,
} from "@/lib/cart/cart-outbound-delivery-kind";
import { getMemberOutboundShipmentPhaseCopy } from "@/lib/cart/member-outbound-shipment-copy";
import { isActiveMemberReturnPhase } from "@/lib/cart/member-return-shipment-copy";
import { buildMondialRelayTrackingUrl } from "@/lib/shipping/mondial-relay-tracking-url";
import { cn } from "@/lib/utils/cn";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";

export function outboundCalloutDismissStorageKey(cartId: string, status: string): string {
  return `segna:exchange:outbound-shipment-callout-dismissed:${cartId}:${status.toLowerCase()}`;
}

type ExchangeOutboundShipmentCalloutProps = {
  summary: OutboundShipmentSummary;
  /** Sans marge horizontale / basse (ex. pile d’alertes sous le header). */
  embedded?: boolean;
  /** Dans une pile : seule la carte du dessus reçoit les clics. */
  stackInteractive?: boolean;
  /** Après fermeture (croix) ou CTA principal. */
  onDismissed?: () => void;
};

/**
 * Carte sous le titre Échange : suivi aller, CTA commande ou emprunt, fermeture persistante (statut courant).
 */
export function ExchangeOutboundShipmentCallout({
  summary,
  embedded = false,
  stackInteractive = true,
  onDismissed,
}: ExchangeOutboundShipmentCalloutProps) {
  const st = summary.status.toLowerCase();
  const copy = getMemberOutboundShipmentPhaseCopy(summary.status);
  const key = outboundCalloutDismissStorageKey(summary.cartId, summary.status);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(key) !== "1");
    } catch {
      setVisible(true);
    }
    setReady(true);
  }, [key]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // no-op
    }
    setVisible(false);
    onDismissed?.();
  }, [key, onDismissed]);

  if (st === "closed" || !ready || !visible) return null;

  const delivered = st === "delivered";
  const isUber =
    isUberCartOutboundShipment({
      outboundProviderCode: summary.outboundProviderCode,
      memberTrackingUrl: summary.memberTrackingUrl,
      trackingNumber: summary.trackingNumber,
    }) ||
    checkoutMetaIndicatesUberDirect(summary.checkoutDeliveryChannel, summary.checkoutHomeSpeed);
  const trackingUrl = isUber
    ? summary.memberTrackingUrl
    : summary.trackingNumber != null
      ? buildMondialRelayTrackingUrl(summary.trackingNumber)
      : null;
  const trackingLinkLabel = isUber ? "Voir le suivi Uber" : "Suivre sur Mondial Relay";
  const returnActive = isActiveMemberReturnPhase(summary.returnShipmentStatus);
  const ctaHref = delivered
    ? returnActive
      ? `/exchange/retour/${summary.cartId}`
      : `/exchange/emprunt/${summary.cartId}`
    : `/commande/${summary.cartId}`;
  const ctaLabel = delivered ? (returnActive ? "Voir mon retour" : "Voir mon emprunt") : "Voir ma commande";

  const card = (
    <div
      className={cn(
        "relative rounded-2xl p-4 backdrop-blur-[2px]",
        delivered
          ? "border border-emerald-300/90 bg-emerald-100/65 shadow-[0_8px_30px_rgba(16,185,129,0.12)]"
          : "border border-zinc-300/90 bg-zinc-50/90 shadow-[0_8px_30px_rgba(24,24,27,0.08)]",
        embedded && !stackInteractive && "pointer-events-none select-none",
      )}
      role="status"
      aria-live="polite"
    >
        <button
          type="button"
          onClick={dismiss}
          className={cn(
            "absolute right-2 top-2 z-[1] inline-flex h-10 w-10 items-center justify-center rounded-full transition",
            delivered
              ? "text-emerald-950 hover:bg-emerald-200/50"
              : "text-zinc-800 hover:bg-zinc-200/70",
          )}
          aria-label="Fermer"
        >
          <X className="h-5 w-5" strokeWidth={2.25} />
        </button>

        {/* Décalage à droite seulement pour le texte (croix), pas le CTA — marges latérales symétriques pour le bouton */}
        <div className="min-w-0 pr-10">
          {delivered ? (
            <p className="text-[15px] font-semibold text-emerald-950">{copy.title}</p>
          ) : (
            <h2
              className={cn(
                "text-[22px] font-bold leading-tight text-zinc-900",
                segnaPlayfairDisplay.className,
                SEGNA_SECTION_TITLE_CLASSNAME,
              )}
            >
              {copy.title}
            </h2>
          )}

          <p
            className={cn(
              "mt-1.5 text-sm leading-snug",
              delivered ? "text-emerald-900/90" : "text-[14px] font-medium text-zinc-600",
            )}
          >
            {copy.detail}
          </p>

          {summary.trackingNumber ? (
            <div
              className={cn(
                "mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[14px] leading-snug",
                delivered ? "text-emerald-900/90" : "text-zinc-700",
              )}
            >
              <span className={delivered ? "text-emerald-800/90" : "text-zinc-600"}>Suivi</span>
              <span
                className={cn("font-mono text-[15px] font-semibold", delivered ? "text-emerald-950" : "text-zinc-900")}
              >
                {summary.trackingNumber}
              </span>
              {trackingUrl ? (
                <>
                  <span className={delivered ? "text-emerald-700/70" : "text-zinc-400"} aria-hidden>
                    ·
                  </span>
                  <a
                    href={trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "font-bold underline underline-offset-2",
                      delivered ? "text-emerald-950" : "text-zinc-900",
                    )}
                  >
                    {trackingLinkLabel}
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <Link
          href={ctaHref}
          onClick={dismiss}
          className={cn(
            "mt-3 flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-bold text-white",
            delivered ? "bg-emerald-900" : "bg-zinc-950 hover:bg-zinc-900",
          )}
        >
          {ctaLabel}
        </Link>
    </div>
  );

  if (embedded) return card;
  return <div className="px-5 pb-3">{card}</div>;
}
