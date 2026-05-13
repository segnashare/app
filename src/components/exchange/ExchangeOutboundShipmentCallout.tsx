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
  const showTracking = !delivered && st !== "ready" && Boolean(summary.trackingNumber);
  const isUber = showTracking
    ? isUberCartOutboundShipment({
        outboundProviderCode: summary.outboundProviderCode,
        memberTrackingUrl: summary.memberTrackingUrl,
        trackingNumber: summary.trackingNumber,
      }) ||
      checkoutMetaIndicatesUberDirect(summary.checkoutDeliveryChannel, summary.checkoutHomeSpeed)
    : false;
  const trackingUrl = showTracking
    ? isUber
      ? summary.memberTrackingUrl
      : summary.trackingNumber != null
        ? buildMondialRelayTrackingUrl(summary.trackingNumber)
        : null
    : null;

  const ctaHref = `/commande/${summary.cartId}`;
  const ctaLabel = delivered ? "Vérifie ta commande" : "Voir ma commande";

  const card = (
    <div
      className={cn(
        "relative rounded-2xl border border-zinc-300/90 bg-zinc-50/90 p-4 shadow-[0_8px_30px_rgba(24,24,27,0.08)] backdrop-blur-[2px]",
        embedded && !stackInteractive && "pointer-events-none select-none",
      )}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 z-[1] inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-800 transition hover:bg-zinc-200/70"
        aria-label="Fermer"
      >
        <X className="h-5 w-5" strokeWidth={2.25} />
      </button>

      <div className="min-w-0 pr-10">
        <h2
          className={cn(
            "text-[22px] font-bold leading-tight text-zinc-900",
            segnaPlayfairDisplay.className,
            SEGNA_SECTION_TITLE_CLASSNAME,
          )}
        >
          {copy.title}
        </h2>

        <p className="mt-1.5 text-[14px] font-medium leading-snug text-zinc-600">{copy.detail}</p>
      </div>

      {showTracking && trackingUrl ? (
        <a
          href={trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex w-full items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-2.5 text-sm font-bold text-zinc-900 shadow-sm hover:bg-zinc-50"
        >
          Voir le suivi
        </a>
      ) : null}

      <Link
        href={ctaHref}
        onClick={dismiss}
        className={cn(
          "flex w-full items-center justify-center rounded-full bg-zinc-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-900",
          showTracking && trackingUrl ? "mt-3" : "mt-4",
        )}
      >
        {ctaLabel}
      </Link>
    </div>
  );

  if (embedded) return card;
  return <div className="px-5 pb-3">{card}</div>;
}
