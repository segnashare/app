import type { RelayDeliveryProduct } from "@/lib/mondial-relay/build-item-shipment";

export const RELAY_PRODUCTS = new Set<RelayDeliveryProduct>(["24R", "24L", "LCC", "XOH"]);

export function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function optionalInt(formData: FormData, key: string): number | null {
  const s = str(formData, key);
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function optionalPositiveInt(formData: FormData, key: string): number | null {
  const n = optionalInt(formData, key);
  return n != null && n > 0 ? n : null;
}

export function parseCollectionMode(raw: string | null): "REL" | "CCC" | null {
  const s = raw?.trim().toUpperCase();
  if (s === "CCC" || s === "REL") return s;
  return null;
}

export function parseRelayProduct(raw: string | null): RelayDeliveryProduct | null {
  const s = raw?.trim().toUpperCase() as RelayDeliveryProduct;
  return s && RELAY_PRODUCTS.has(s) ? s : null;
}
