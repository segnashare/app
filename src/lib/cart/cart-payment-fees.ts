/** Constantes alignées panier / paiement / Stripe Checkout commande (montants HT — TVA appliquée au passage en caisse). */

export const CART_SERVICE_FEE_EUROS = 0.99;
export const CART_SERVICE_FEE_CENTS = 99;

/** Frais de service HT : 0,99 € au-delà de 3 pièces, sinon 0. */
export function cartPaymentServiceFeeHtCents(itemCount: number): number {
  return itemCount > 3 ? CART_SERVICE_FEE_CENTS : 0;
}

