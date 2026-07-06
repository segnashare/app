import type { MembershipLabel } from "@/lib/user/resolve-membership-label";
import {
  BORROW_CHECKOUT_OPTIONS_FALLBACK,
  computeItemRentalEuroCents,
  computeMissingCreditsCashCents,
  formatEuroPerCredit,
  shortestBorrowCheckoutOption,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";

/** Guest : location 100 % en €, sans wallet ni complément partiel. */
export function isGuestCashRentalMode(membershipLabel: MembershipLabel | string): boolean {
  return membershipLabel === "Guest";
}

/** Prix hebdo catalogue (palier 7 jours). */
export function computeItemWeeklyRentalEuroCents(
  pricePoints: number | null | undefined,
  options: ReadonlyArray<BorrowCheckoutOption> = BORROW_CHECKOUT_OPTIONS_FALLBACK,
): number {
  const base = shortestBorrowCheckoutOption(options);
  return computeItemRentalEuroCents(pricePoints, base.durationDays, options);
}

export function formatWeeklyRentalPrice(
  pricePoints: number | null | undefined,
  options: ReadonlyArray<BorrowCheckoutOption> = BORROW_CHECKOUT_OPTIONS_FALLBACK,
): string {
  const cents = computeItemWeeklyRentalEuroCents(pricePoints, options);
  return `${formatEuroPerCredit(cents)} / semaine`;
}

/** Location Guest : 100 % du panier (crédits × tarif durée). */
export function computeGuestCartRentalEuroCents(
  cartTotalPoints: number,
  durationDays: number,
  options: ReadonlyArray<BorrowCheckoutOption>,
): number {
  const total = Math.max(0, Math.trunc(cartTotalPoints));
  if (total <= 0) return 0;
  return computeMissingCreditsCashCents(total, durationDays, options);
}

/** Points Stripe comp = total panier (wallet_debit = 0 côté RPC). */
export function guestStripeCompPoints(cartTotalPoints: number): number {
  return Math.max(0, Math.trunc(cartTotalPoints));
}

type GuestCashRentalOrderDisplayInput = {
  totalPoints: number;
  checkoutBorrowDurationDays?: number | null;
  paymentBreakdown?: {
    creditSplit?: {
      pointsFromLendingBalance: number;
      pointsFromExchangeComplement: number;
    } | null;
    euroDetail?: { complementCreditsEuros: number } | null;
  } | null;
};

/** Affichage historique commande / emprunt en € (Guest actuel ou commande location € passée). */
export function isGuestCashRentalOrderDisplay(
  membershipLabel: MembershipLabel | string,
  detail: GuestCashRentalOrderDisplayInput,
): boolean {
  if (isGuestCashRentalMode(membershipLabel)) return true;
  const split = detail.paymentBreakdown?.creditSplit;
  if (!split || detail.totalPoints <= 0) return false;
  return (
    split.pointsFromLendingBalance === 0 &&
    split.pointsFromExchangeComplement >= detail.totalPoints &&
    (detail.paymentBreakdown?.euroDetail?.complementCreditsEuros ?? 0) > 0.005
  );
}

/** Prix de location TTC affiché sur une commande Guest (€ facturés ou recalcul). */
export function resolveGuestOrderRentalEuros(
  detail: GuestCashRentalOrderDisplayInput,
  options: ReadonlyArray<BorrowCheckoutOption> = BORROW_CHECKOUT_OPTIONS_FALLBACK,
): number {
  const fromInvoice = detail.paymentBreakdown?.euroDetail?.complementCreditsEuros;
  if (fromInvoice != null && fromInvoice > 0.005) return fromInvoice;
  const durationDays =
    detail.checkoutBorrowDurationDays != null && detail.checkoutBorrowDurationDays >= 1
      ? detail.checkoutBorrowDurationDays
      : shortestBorrowCheckoutOption(options).durationDays;
  return computeGuestCartRentalEuroCents(detail.totalPoints, durationDays, options) / 100;
}
