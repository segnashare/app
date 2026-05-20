import { htToVatAndTtcCents } from "@/lib/cart/cart-checkout-vat";

const MAX_ITEMS = 10;

/** Retour point relais TTC : ≤3 pièces (≤1 kg) → 3,50 € ; 4+ pièces (1–2 kg) → 4,50 €. */
export function checkoutReturnRelayFeeTtcCents(itemCount: number): number {
  const n = Math.min(Math.max(Math.floor(itemCount), 1), MAX_ITEMS);
  return n <= 3 ? 350 : 450;
}

export function checkoutReturnRelayFeeHtCents(itemCount: number): number {
  const ttc = checkoutReturnRelayFeeTtcCents(itemCount);
  return Math.round(ttc / (1 + 0.2));
}

export function checkoutReturnRelayFeePricing(itemCount: number): {
  htCents: number;
  ttcCents: number;
} {
  const htCents = checkoutReturnRelayFeeHtCents(itemCount);
  const { ttcCents } = htToVatAndTtcCents(htCents);
  return { htCents, ttcCents };
}
