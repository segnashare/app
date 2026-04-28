import type { CartCheckoutPaymentDetail } from "@/lib/stripe/fetch-cart-checkout-payment-detail";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OutboundSnapshot = {
  outboundProviderCode?: string | null;
  memberTrackingUrl?: string | null;
  trackingNumber?: string | null;
} | null;

/** Aller panier via Uber Direct (provider en base, URL Uber, ou id de livraison type UUID). */
export function isUberCartOutboundShipment(s: OutboundSnapshot | undefined): boolean {
  if (!s) return false;
  if (s.outboundProviderCode === "uber_direct") return true;
  if (s.memberTrackingUrl && /uber\.com/i.test(s.memberTrackingUrl)) return true;
  const tn = s.trackingNumber;
  if (tn && UUID_RE.test(tn)) return true;
  return false;
}

/** Même logique que le checkout : domicile + vitesse Uber (metadata Stripe / snapshot facture). */
export function checkoutMetaIndicatesUberDirect(
  deliveryChannel: string | null | undefined,
  homeSpeed: string | null | undefined,
): boolean {
  if ((deliveryChannel ?? "").trim().toLowerCase() !== "home") return false;
  const hs = (homeSpeed ?? "").trim().toLowerCase();
  return hs === "uber_direct" || hs === "priority";
}

export function checkoutPaymentIndicatesUberDirect(
  euro: CartCheckoutPaymentDetail | null | undefined,
): boolean {
  if (!euro) return false;
  return checkoutMetaIndicatesUberDirect(euro.checkoutDeliveryChannel, euro.checkoutHomeSpeed);
}
