import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/** Champs renvoyés par `get_current_membership_state()` (usage livraisons incluses). */

export function parseRemainingIncludedOrdersThisMonth(data: unknown): number {
  if (data == null || typeof data !== "object") return 0;
  const row = data as Record<string, unknown>;
  const raw = row.remaining_orders_this_month;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 0;
}

export function parseBonusIncludedOrdersRemaining(data: unknown): number {
  if (data == null || typeof data !== "object") return 0;
  const raw = (data as Record<string, unknown>).bonus_included_orders_remaining;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return 0;
}

export function parseSubscriptionIncludedOrdersRemaining(data: unknown): number {
  if (data == null || typeof data !== "object") return 0;
  const raw = (data as Record<string, unknown>).remaining_subscription_orders_this_month;
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

/** Compteur consommé/plafond mensuel abonnement (ex. `0/2`) — pas pour Guest ni crédits bonus seuls. */
export function formatIncludedShippingQuotaLabel(
  membershipLabel: MembershipLabel,
  subscriptionRemaining: number,
  subscriptionLimit: number,
): string | null {
  if (membershipLabel !== "Membre X") return null;
  if (subscriptionLimit <= 0 || subscriptionRemaining < 0) return null;
  const used = includedOrdersUsedThisMonth(subscriptionRemaining, subscriptionLimit);
  return `${used}/${subscriptionLimit}`;
}

/** Nombre d’inclusions déjà consommées ce mois (plafond − restant). */
export function includedOrdersUsedThisMonth(remaining: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(limit, Math.max(0, limit - remaining));
}

/** Libellé sous la ligne livraison quand un échange inclus est disponible. */
export function formatIncludedShippingForfaitLine(
  label: MembershipLabel,
  remainingTotal: number,
  opts?: { bonusRemaining?: number; subscriptionRemaining?: number },
): string {
  if (remainingTotal <= 0) return "";
  const bonus = Math.max(0, opts?.bonusRemaining ?? 0);
  const sub = Math.max(0, opts?.subscriptionRemaining ?? 0);

  if (label === "Guest" || (bonus > 0 && sub <= 0)) {
    return bonus === 1 ? "1 échange inclus disponible" : `${bonus} échanges inclus disponibles`;
  }

  const forfaitName =
    label === "Membre X" ? "SegnaX" : label === "Membre +" ? "Segna+" : null;
  if (forfaitName) {
    const subLine =
      sub === 1
        ? `1 échange inclus ce mois (${forfaitName})`
        : `${sub} échanges inclus ce mois (${forfaitName})`;
    if (bonus > 0) {
      return `${subLine} · +${bonus} échange${bonus > 1 ? "s" : ""} bonus`;
    }
    return subLine;
  }
  return remainingTotal === 1 ? "1 échange inclus disponible" : `${remainingTotal} échanges inclus disponibles`;
}
