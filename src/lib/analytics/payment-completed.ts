import "server-only";

import { trackServerEvent } from "@/lib/analytics/track-server";

/**
 * Typologie fine de ce qui est payé — une seule nomenclature pour tout le business :
 *
 * | product_type            | product_family | Quoi                                                        |
 * |-------------------------|----------------|-------------------------------------------------------------|
 * | piece_purchase          | purchase       | Achat d'une pièce du catalogue (purchase_mode)              |
 * | piece_buyout            | purchase       | Rachat d'une pièce actuellement louée (cart-buyout)         |
 * | rental_week             | rental         | Location « Guest » payée à la semaine (≤ 7 j)               |
 * | rental_month            | rental         | Location « Guest » payée au mois (≥ 28 j)                   |
 * | rental_other            | rental         | Location « Guest » autre durée (ex. 14 j, legacy)           |
 * | member_borrow           | subscription_usage | Emprunt d'un·e abonné·e (consommation de l'abonnement)  |
 * | subscription_monthly    | subscription   | Souscription SegnaX sans engagement (mensuel)               |
 * | subscription_3_months   | subscription   | Souscription SegnaX avec engagement 3 mois (prépayé)        |
 */
export type PaymentProductType =
  | "piece_purchase"
  | "piece_buyout"
  | "rental_week"
  | "rental_month"
  | "rental_other"
  | "member_borrow"
  | "subscription_monthly"
  | "subscription_3_months";

export type PaymentProductFamily = "purchase" | "rental" | "subscription_usage" | "subscription";

export type PaymentCustomerType = "member" | "guest";

export type PaymentClassification = {
  product_type: PaymentProductType;
  product_family: PaymentProductFamily;
  customer_type: PaymentCustomerType;
};

export type PaymentCompletedProps = PaymentClassification & {
  /** Montant réellement encaissé en carte (centimes TTC). 0 si payé 100 % en crédits. */
  amount_cents?: number;
  /** Crédits d'abonnement (mods) consommés par la commande. */
  credits_used_mods?: number;
  /** Crédits manquants payés en complément (mods). */
  missing_credits_mods?: number;
  /** Échange / livraison inclus dans l'abonnement utilisé. */
  used_included_order?: boolean;
  borrow_duration_days?: number;
  item_count?: number;
  cart_id?: string;
  plan_code?: string;
  billing_term?: string;
  first_month_percent_off?: number;
  stripe_subscription_id?: string;
  checkout_mode?: string;
  /** Surface d'origine : website | mobile | webapp (sinon `server`). */
  surface?: string;
};

function parseIntSafe(raw: unknown): number | undefined {
  if (raw == null || String(raw).trim() === "") return undefined;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Classe une commande panier (location / achat / emprunt abonné) depuis la metadata Stripe. */
export function classifyCartOrderFromMetadata(
  metadata: Record<string, string | undefined> | null | undefined,
): PaymentClassification {
  const isGuest = metadata?.guest_cash_rental === "true";
  const customer_type: PaymentCustomerType = isGuest ? "guest" : "member";

  if (metadata?.purchase_mode === "true") {
    return { product_type: "piece_purchase", product_family: "purchase", customer_type };
  }
  if (!isGuest) {
    return { product_type: "member_borrow", product_family: "subscription_usage", customer_type };
  }
  const days = parseIntSafe(metadata?.borrow_duration_days);
  if (days != null && days <= 7) {
    return { product_type: "rental_week", product_family: "rental", customer_type };
  }
  if (days != null && days >= 28) {
    return { product_type: "rental_month", product_family: "rental", customer_type };
  }
  return { product_type: "rental_other", product_family: "rental", customer_type };
}

/** Classe une souscription d'abonnement selon l'engagement. */
export function classifySubscription(billingTerm: string | null | undefined): PaymentClassification {
  const threeMonths = (billingTerm ?? "").toLowerCase().includes("3");
  return {
    product_type: threeMonths ? "subscription_3_months" : "subscription_monthly",
    product_family: "subscription",
    customer_type: "member",
  };
}

/**
 * Événement agrégé unique pour TOUT paiement / consommation (achat, location, abonnement,
 * emprunt abonné). Permet une vue « revenus & consommation » détaillée et agrégée.
 * `insertId` = même clé que l'événement métier pour éviter les doublons (webhook + confirm).
 */
export function trackPaymentCompletedServer(
  userId: string,
  insertId: string,
  properties: PaymentCompletedProps,
): void {
  trackServerEvent("payment_completed", { distinctId: userId, insertId: `payment_completed:${insertId}` }, properties);
}
