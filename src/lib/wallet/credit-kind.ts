import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/** Valeurs canoniques (RPC `wallet_credit_purchase`, metadata Stripe, `wallet_transactions.metadata.credits_kind`). */
export type WalletCreditKind = "consumption" | "exchange";

export function walletCreditKindLabel(kind: WalletCreditKind): string {
  return kind === "consumption" ? "crédits de consommation" : "crédits d'échange";
}

/** Invité → consommation ; abonné actif → échange. */
export function walletCreditKindForMembership(label: MembershipLabel): WalletCreditKind {
  return label === "Guest" ? "consumption" : "exchange";
}

/**
 * Dérivé du couple plan Stripe + statut (route achat pack « Obtenir plus »).
 * Sans abonnement actif → consommation.
 */
export function walletCreditKindForBillingSubscription(
  planCode: string | null | undefined,
  subscriptionStatus: string | null | undefined,
): WalletCreditKind {
  const plan = (planCode ?? "").toLowerCase();
  const status = (subscriptionStatus ?? "").toLowerCase();
  const active = status === "active" || status === "trialing";
  if (!active) return "consumption";
  if (plan === "segna_x" || plan === "segna_plus") return "exchange";
  return "consumption";
}

/**
 * Normalise l’entrée RPC / metadata (y compris anciennes sessions `pods` / `mods`).
 */
export function normalizeWalletCreditKind(raw: string | null | undefined): WalletCreditKind {
  const k = (raw ?? "").trim().toLowerCase();
  if (k === "exchange" || k === "mods") return "exchange";
  if (k === "consumption" || k === "pods" || k === "consommation") return "consumption";
  return "consumption";
}
