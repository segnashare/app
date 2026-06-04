import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

/** Valeurs canoniques (RPC `wallet_credit_purchase`, metadata Stripe, `wallet_transactions.metadata.credits_kind`). */
export type WalletCreditKind = "consumption" | "exchange";

/** Libellé court du seau bonus (wallet, filtres). */
export const WALLET_BONUS_BUCKET_SHORT_LABEL = "Bonus";

/** Libellé membre pour les crédits offerts par Segna (`consumption` en base). */
export const WALLET_BONUS_CREDITS_LABEL = "crédits bonus";

export function walletBonusCreditsAriaLabel(points: number): string {
  const n = Number.isFinite(points) ? Math.floor(points) : 0;
  const formatted = n.toLocaleString("fr-FR");
  return `${formatted} ${n === 1 ? "crédit bonus" : "crédits bonus"}`;
}

export function walletCreditKindLabel(kind: WalletCreditKind): string {
  return kind === "consumption" ? WALLET_BONUS_CREDITS_LABEL : "crédits";
}

/**
 * Bucket Stripe / wallet pour les mods (panier, compléments, packs « Obtenir plus »).
 * L’échange n’est plus réservé aux seuls abonnés Membre + / X : tout membre utilise le même kind côté facturation wallet.
 */
export function walletCreditKindForMembership(_label: MembershipLabel): WalletCreditKind {
  return "exchange";
}

/**
 * Packs crédits « Obtenir plus » (`/api/stripe/credits/checkout`) et complément wallet payé au checkout panier
 * (`stripe:cart_order_wallet:*`) : crédits Segna (consommation).
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
