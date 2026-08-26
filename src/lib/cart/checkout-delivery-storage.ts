import { encodeSendcloudRelayPointRef } from "@/lib/sendcloud/relay-point-ref";

/** Données de livraison checkout (session navigateur). */

export const CHECKOUT_DELIVERY_ADDRESS_KEY = "segna:checkout-delivery-address";
export const CHECKOUT_DELIVERY_INSTRUCTIONS_KEY = "segna:checkout-delivery-instructions";
export const CHECKOUT_RELAY_SELECTION_KEY = "segna:checkout-relay-selection";
/** Point relais hub pour le retour (dépôt membre → centre logistique). */
export const CHECKOUT_RETURN_RELAY_SELECTION_KEY = "segna:checkout-return-relay-selection";
export const CHECKOUT_DELIVERY_CHANNEL_KEY = "segna:checkout-delivery-channel";
export const CHECKOUT_HOME_SPEED_KEY = "segna:checkout-home-speed";
export const CHECKOUT_COURSIER_SLOT_KEY = "segna:checkout-coursier-slot-key";

/** Onglet checkout « Point relais » / « Domicile » — persistant pour navigation / remontage. */
export type CheckoutDeliveryChannel = "relay" | "home";

/** Sous-mode domicile : barème standard vs Uber Direct — persistant avec l’onglet. */
export type CheckoutHomeDeliverySpeed = "standard" | "uber_direct";

export type CheckoutDeliveryAddress = {
  label: string;
  lat: number;
  lon: number;
  city: string | null;
  relativeCity: string | null;
  timezone: string;
  /** CP explicite (website achat) — prioritaire sur l’extraction depuis `label`. */
  postalCode?: string | null;
};

export type CheckoutRelaySelection = {
  code: string;
  label: string;
  postalCode: string;
  city?: string;
  /** Nom du point (ex. LOCKER TELESPACE…) — affichage carte Sendcloud. */
  name?: string;
  /** Adresse rue + n° — affichage carte Sendcloud. */
  street?: string;
  /** Distance en mètres depuis le CP de recherche (widget SPP). */
  distanceMeters?: number;
  /** Libellé horaires style Sendcloud (« Ouvert demain: 10:30 - 21:00 »). */
  hoursLabel?: string;
  /** Id Sendcloud service point (widget ou API). */
  sendcloudServicePointId?: number;
  /** ex. mondial_relay, colissimo — pour l’étiquette Sendcloud. */
  sendcloudCarrier?: string;
  sendcloudPostNumber?: string;
  /** Retour hub (liste `return-relay-points`). */
  isHubReturn?: boolean;
};

export type CheckoutReturnRelaySelection = CheckoutRelaySelection;

/** Valeur stockée en base / Stripe metadata pour expédition Sendcloud. */
export function checkoutRelayProviderPointId(relay: CheckoutRelaySelection): string {
  if (relay.sendcloudServicePointId != null && relay.sendcloudServicePointId > 0) {
    return encodeSendcloudRelayPointRef({
      servicePointId: relay.sendcloudServicePointId,
      carrier: relay.sendcloudCarrier,
      postNumber: relay.sendcloudPostNumber,
    });
  }
  return relay.code.trim();
}

export function readCheckoutDeliveryAddress(): CheckoutDeliveryAddress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_DELIVERY_ADDRESS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as CheckoutDeliveryAddress;
    if (typeof o?.label !== "string" || o.label.trim() === "") return null;
    return o;
  } catch {
    return null;
  }
}

export function writeCheckoutDeliveryAddress(value: CheckoutDeliveryAddress) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CHECKOUT_DELIVERY_ADDRESS_KEY, JSON.stringify(value));
}

export function readCheckoutDeliveryInstructions(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(CHECKOUT_DELIVERY_INSTRUCTIONS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeCheckoutDeliveryInstructions(text: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CHECKOUT_DELIVERY_INSTRUCTIONS_KEY, text);
}

export function readCheckoutRelaySelection(): CheckoutRelaySelection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_RELAY_SELECTION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as CheckoutRelaySelection;
    if (typeof o?.code !== "string" || o.code.trim() === "") return null;
    return o;
  } catch {
    return null;
  }
}

export function writeCheckoutRelaySelection(value: CheckoutRelaySelection | null) {
  if (typeof window === "undefined") return;
  if (value == null) {
    window.sessionStorage.removeItem(CHECKOUT_RELAY_SELECTION_KEY);
    return;
  }
  window.sessionStorage.setItem(CHECKOUT_RELAY_SELECTION_KEY, JSON.stringify(value));
}

export function readCheckoutReturnRelaySelection(): CheckoutReturnRelaySelection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_RETURN_RELAY_SELECTION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as CheckoutReturnRelaySelection;
    if (typeof o?.code !== "string" || o.code.trim() === "") return null;
    return { ...o, isHubReturn: true };
  } catch {
    return null;
  }
}

export function writeCheckoutReturnRelaySelection(value: CheckoutReturnRelaySelection | null) {
  if (typeof window === "undefined") return;
  if (value == null) {
    window.sessionStorage.removeItem(CHECKOUT_RETURN_RELAY_SELECTION_KEY);
    return;
  }
  window.sessionStorage.setItem(
    CHECKOUT_RETURN_RELAY_SELECTION_KEY,
    JSON.stringify({ ...value, isHubReturn: true }),
  );
}

/** Métadonnées retour hub pour `confirm_cart` / shipment_destinations. */
export function checkoutReturnRelayFields(relay: CheckoutReturnRelaySelection): {
  returnRelayPointId: string;
  returnRelayLabel: string;
  returnRelaySearchPostalCode: string;
} {
  return {
    returnRelayPointId: checkoutRelayProviderPointId(relay).slice(0, 120),
    returnRelayLabel: relay.label.trim().slice(0, 220),
    returnRelaySearchPostalCode: relay.postalCode.replace(/\D/g, "").slice(0, 5),
  };
}

export function readCheckoutDeliveryChannel(): CheckoutDeliveryChannel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_DELIVERY_CHANNEL_KEY);
    if (raw === "relay" || raw === "home") return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeCheckoutDeliveryChannel(value: CheckoutDeliveryChannel) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CHECKOUT_DELIVERY_CHANNEL_KEY, value);
}

export function readCheckoutHomeSpeed(): CheckoutHomeDeliverySpeed | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_HOME_SPEED_KEY);
    if (raw === "standard" || raw === "uber_direct") return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeCheckoutHomeSpeed(value: CheckoutHomeDeliverySpeed) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CHECKOUT_HOME_SPEED_KEY, value);
}

export function readCheckoutCoursierSlotKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_COURSIER_SLOT_KEY)?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function writeCheckoutCoursierSlotKey(value: string | null) {
  if (typeof window === "undefined") return;
  if (value == null || !value.trim()) {
    window.sessionStorage.removeItem(CHECKOUT_COURSIER_SLOT_KEY);
    return;
  }
  window.sessionStorage.setItem(CHECKOUT_COURSIER_SLOT_KEY, value.trim());
}

/** Champs suffisants pour détecter Paris (client ou corps JSON API checkout). */
export type ParisDeliveryCheckFields = {
  label?: string;
  city?: string | null;
  relativeCity?: string | null;
};

/** Paris intra-muros : ville Paris ou libellé BAN avec arrondissement. */
export function isParisDeliveryAreaFields(addr: ParisDeliveryCheckFields | null): boolean {
  if (!addr) return false;
  const city = (addr.city ?? "").trim();
  if (/^Paris$/i.test(city)) return true;
  const label = (addr.label ?? "").toLowerCase();
  if (label && /\b750\d{2}\b/.test(label) && label.includes("paris")) return true;
  const rel = (addr.relativeCity ?? "").toLowerCase();
  if (rel.startsWith("paris") && /\d/.test(rel)) return true;
  return false;
}

export function isParisDeliveryArea(addr: CheckoutDeliveryAddress | null): boolean {
  if (!addr) return false;
  return isParisDeliveryAreaFields({
    label: addr.label,
    city: addr.city,
    relativeCity: addr.relativeCity,
  });
}
