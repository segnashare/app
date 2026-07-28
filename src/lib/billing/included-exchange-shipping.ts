import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/**
 * Livraison liée à l’« échange inclus » abonnement (quota `included_orders_limit`).
 * - `none` : frais au barème.
 * - `member_all_modes` : relais offert ; domicile (Express / Chrono) = supplément devis − 10 €.
 */
export type IncludedExchangeShippingKind = "none" | "member_all_modes" | "guest_relay_round_trip_equivalent";

/** @deprecated Conservé pour métadonnées historiques ; préférer `member_all_modes`. */
export type LegacyIncludedExchangeShippingKind = "guest_relay_round_trip_equivalent";

export function resolveIncludedExchangeShippingKind(args: {
  membershipLabel: MembershipLabel;
  remainingIncludedOrdersThisMonth: number;
}): IncludedExchangeShippingKind {
  void args.membershipLabel;
  if (args.remainingIncludedOrdersThisMonth <= 0) return "none";
  return "member_all_modes";
}
