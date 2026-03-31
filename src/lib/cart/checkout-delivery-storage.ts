/** Données de livraison checkout (session navigateur). */

export const CHECKOUT_DELIVERY_ADDRESS_KEY = "segna:checkout-delivery-address";
export const CHECKOUT_DELIVERY_INSTRUCTIONS_KEY = "segna:checkout-delivery-instructions";
export const CHECKOUT_RELAY_SELECTION_KEY = "segna:checkout-relay-selection";

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

/** Paris intra-muros : ville Paris ou libellé BAN avec arrondissement. */
export function isParisDeliveryArea(addr: CheckoutDeliveryAddress | null): boolean {
  if (!addr) return false;
  const city = (addr.city ?? "").trim();
  if (/^Paris$/i.test(city)) return true;
  const label = addr.label.toLowerCase();
  if (/\b750\d{2}\b/.test(label) && label.includes("paris")) return true;
  const rel = (addr.relativeCity ?? "").toLowerCase();
  if (rel.startsWith("paris") && /\d/.test(rel)) return true;
  return false;
}
