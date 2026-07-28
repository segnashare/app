/**
 * Tax rate Stripe « TVA France 20 % » (montants TTC inclusifs).
 * Dashboard → Product catalog → Tax rates, ou variable `STRIPE_FR_VAT_20_TAX_RATE_ID`.
 */
export function resolveFrVat20TaxRateId(): string | null {
  const id = process.env.STRIPE_FR_VAT_20_TAX_RATE_ID?.trim();
  return id || null;
}

/** Params line item / invoice item pour afficher le détail TVA sur la facture Stripe. */
export function stripeFrVat20TaxParams():
  | { tax_rates: string[]; tax_behavior: "inclusive" }
  | Record<string, never> {
  const taxRateId = resolveFrVat20TaxRateId();
  if (!taxRateId) return {};
  return { tax_rates: [taxRateId], tax_behavior: "inclusive" };
}
