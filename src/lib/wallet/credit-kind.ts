import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/** Valeurs canoniques (RPC `wallet_credit_purchase`, metadata Stripe, `wallet_transactions.metadata.credits_kind`). */
export type WalletCreditKind = "consumption" | "exchange";

export function walletCreditKindLabel(kind: WalletCreditKind): string {
  return kind === "consumption" ? "crédits de consommation" : "crédits d'échange";
}

/**
 * Bucket Stripe / wallet pour les mods (panier, compléments, packs « Obtenir plus »).
 * L’échange n’est plus réservé aux seuls abonnés Membre + / X : tout membre utilise le même kind côté facturation wallet.
 */
export function walletCreditKindForMembership(_label: MembershipLabel): WalletCreditKind {
  return "exchange";
}

/**
 * Packs crédits « Obtenir plus » (checkout `/api/stripe/credits/checkout`) : crédits de consommation,
 * utilisables sur le dressing partagé — distincts des compléments panier / échange (`walletCreditKindForMembership`).
 */
export function walletCreditKindForBillingSubscription(
  _planCode: string | null | undefined,
  _subscriptionStatus: string | null | undefined,
): WalletCreditKind {
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
