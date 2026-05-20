import { buildMemberCartOrderPageUrl } from "@/lib/notifications/lifecycle-shipment-email";
import { buildMondialRelayTrackingUrl } from "@/lib/shipping/mondial-relay-tracking-url";

export type OutboundTrackingForNotify = {
  /** Référence affichée (Sendcloud ou 8 premiers caractères du panier). */
  orderRef: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

export function resolveOutboundTrackingForNotify(input: {
  cartId: string;
  trackingNumber?: string | null;
  memberTrackingUrl?: string | null;
  isUberHome: boolean;
  sendcloudOrderNumber?: string | null;
}): OutboundTrackingForNotify {
  const cartId = input.cartId.trim();
  const orderRef =
    input.sendcloudOrderNumber?.trim() ||
    (cartId ? cartId.replace(/-/g, "").slice(0, 8).toUpperCase() : "");

  const trackingNumber = input.trackingNumber?.trim() || null;
  const memberUrl = input.memberTrackingUrl?.trim() || null;
  const orderPageUrl = buildMemberCartOrderPageUrl(cartId);

  let trackingUrl: string | null = null;
  if (input.isUberHome) {
    trackingUrl = memberUrl || orderPageUrl;
  } else if (trackingNumber) {
    trackingUrl = buildMondialRelayTrackingUrl(trackingNumber) || memberUrl || orderPageUrl;
  } else {
    trackingUrl = memberUrl || orderPageUrl;
  }

  return { orderRef, trackingNumber, trackingUrl };
}

export function buildOutboundReadySmsBody(tracking: OutboundTrackingForNotify): string {
  const lines = ["Segna : ton colis est prêt à partir."];
  if (tracking.orderRef) {
    lines.push(`Commande ${tracking.orderRef}.`);
  }
  if (tracking.trackingNumber) {
    lines.push(`Suivi : ${tracking.trackingNumber}.`);
  }
  if (tracking.trackingUrl) {
    lines.push(tracking.trackingUrl);
  } else if (!tracking.trackingNumber) {
    lines.push("Détail dans l’app Segna.");
  }
  return lines.join(" ").slice(0, 320);
}
