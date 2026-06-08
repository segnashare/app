import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/**
 * Règle livraison « incluse » sur le checkout échange :
 * - `none` : tout est facturé au barème (ou Uber devis).
 * - `member_all_modes` : aller-retour + frais de service offerts (relais, domicile, Uber, toute taille panier).
 */
export type IncludedExchangeShippingKind = "none" | "member_all_modes" | "guest_relay_round_trip_equivalent";

/** @deprecated Conservé pour métadonnées historiques ; préférer `member_all_modes`. */
export type LegacyIncludedExchangeShippingKind = "guest_relay_round_trip_equivalent";

export function resolveIncludedExchangeShippingKind(args: {
  membershipLabel: MembershipLabel;
  remainingIncludedOrdersThisMonth: number;
}): IncludedExchangeShippingKind {
  if (args.remainingIncludedOrdersThisMonth <= 0) return "none";
  return "member_all_modes";
}
