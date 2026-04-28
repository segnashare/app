/** Données de livraison checkout (session navigateur). */

export const CHECKOUT_DELIVERY_ADDRESS_KEY = "segna:checkout-delivery-address";
export const CHECKOUT_DELIVERY_INSTRUCTIONS_KEY = "segna:checkout-delivery-instructions";
export const CHECKOUT_RELAY_SELECTION_KEY = "segna:checkout-relay-selection";
export const CHECKOUT_DELIVERY_CHANNEL_KEY = "segna:checkout-delivery-channel";
export const CHECKOUT_HOME_SPEED_KEY = "segna:checkout-home-speed";

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
};

export type CheckoutRelaySelection = {
  code: string;
  label: string;
  postalCode: string;
  city?: string;
};

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
