import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/**
 * Règle livraison « incluse » sur le checkout échange :
 * - `none` : tout est facturé au barème (ou Uber devis).
 * - `member_all_modes` : aller-retour offert quel que soit le mode (relais / domicile / Uber).
 * - `guest_relay_round_trip_equivalent` : valeur d’un aller-retour **point relais** offerte ; domicile / Uber = supplément vs ce barème.
 *
 * Désactiver l’échange gratuit invité : mettre `included_orders_limit = 0` sur le plan `guest` dans `billing_plan_entitlement_limits`.
 */
export type IncludedExchangeShippingKind = "none" | "member_all_modes" | "guest_relay_round_trip_equivalent";

export function resolveIncludedExchangeShippingKind(args: {
  membershipLabel: MembershipLabel;
  remainingIncludedOrdersThisMonth: number;
}): IncludedExchangeShippingKind {
  if (args.remainingIncludedOrdersThisMonth <= 0) return "none";
  if (args.membershipLabel === "Guest") return "guest_relay_round_trip_equivalent";
  return "member_all_modes";
}
