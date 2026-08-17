import {
  computeItemPurchaseEuroCents,
  computeMemberCartPurchaseEuroCents,
} from "@/lib/billing/guest-rental-pricing";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/** Remise spéciale guest pour achat en fin de location (hors remise plan membre). */
export const GUEST_RENTAL_BUYOUT_DISCOUNT_PERCENT = 10;

/**
 * % de réduction buyout :
 * - Guest → 10 % (tarif spécial fin de location)
 * - Membre + / X → % déjà résolu via `fetchPurchaseDiscountPercentForMembership`
 */
export function resolveRentalBuyoutDiscountPercent(
  membershipLabel: MembershipLabel | string,
  memberPurchaseDiscountFromDb: number | null | undefined,
): number {
  if (membershipLabel === "Guest") {
    return GUEST_RENTAL_BUYOUT_DISCOUNT_PERCENT;
  }
  const raw = Number(memberPurchaseDiscountFromDb);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(100, Math.max(0, Math.trunc(raw)));
}

/** Montant TTC cents à facturer pour un buyout (sélection de crédits catalogue). */
export function computeRentalBuyoutEuroCents(
  totalPricePoints: number,
  discountPercent: number,
): number {
  return computeMemberCartPurchaseEuroCents(totalPricePoints, discountPercent);
}

export function computeRentalBuyoutRetailEuroCents(totalPricePoints: number): number {
  return computeItemPurchaseEuroCents(totalPricePoints);
}

export function formatRentalBuyoutEuroTtc(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}
