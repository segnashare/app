import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/** Champs renvoyés par `get_current_membership_state()` (usage livraisons incluses). */

export function parseRemainingIncludedOrdersThisMonth(data: unknown): number {
  if (data == null || typeof data !== "object") return 0;
  const raw = (data as Record<string, unknown>).remaining_orders_this_month;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 0;
}

export function parseIncludedOrdersLimitThisMonth(data: unknown): number {
  if (data == null || typeof data !== "object") return 0;
  const raw = (data as Record<string, unknown>).included_orders_limit;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 0;
}

/** Nombre d’inclusions déjà consommées ce mois (plafond − restant). */
export function includedOrdersUsedThisMonth(remaining: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(limit, Math.max(0, limit - remaining));
}

/** Libellé sous la ligne « Mondial Relay » quand l’aller-retour est couvert par l’abonnement. */
export function formatIncludedShippingForfaitLine(label: MembershipLabel, limit: number): string {
  if (limit <= 0) return "";
  const forfaitName =
    label === "Membre X" ? "SegnaX" : label === "Membre +" ? "Segna+" : null;
  if (forfaitName) {
    return limit === 1
      ? `1 échange inclus dans le forfait ${forfaitName}`
      : `${limit} échanges inclus dans le forfait ${forfaitName}`;
  }
  return limit === 1 ? "1 échange inclus dans ton abonnement" : `${limit} échanges inclus dans ton abonnement`;
}
