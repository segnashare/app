/**
 * Codes promo achat (panier / checkout Stripe).
 * Aligné website `website-purchase-promo-codes.ts`.
 */

export type PurchasePromoReward = "free_shipping";

export type PurchasePromoStatus = "active" | "obsolete";

export type PurchasePromoDefinition = {
  code: string;
  status: PurchasePromoStatus;
  reward: PurchasePromoReward;
};

/** Catalogue : ajouter ici les codes actifs ou obsolètes. */
const PURCHASE_PROMOS: readonly PurchasePromoDefinition[] = [
  {
    code: "120972",
    status: "active",
    reward: "free_shipping",
  },
];

export function normalizePurchasePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function findPurchasePromo(normalized: string): PurchasePromoDefinition | null {
  if (!normalized) return null;
  return (
    PURCHASE_PROMOS.find((p) => normalizePurchasePromoCode(p.code) === normalized) ?? null
  );
}

/** True si le code actif accorde la livraison offerte. */
export function purchasePromoGrantsFreeShipping(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const promo = findPurchasePromo(normalizePurchasePromoCode(raw));
  return promo != null && promo.status === "active" && promo.reward === "free_shipping";
}
