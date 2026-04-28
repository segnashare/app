/** Packs « Obtenir plus » — alignés sur les prix Stripe (`STRIPE_PRICE_CREDITS_*`). */
export const CREDIT_PACK_AMOUNTS = [200, 500, 1000] as const;
export type CreditPackAmount = (typeof CREDIT_PACK_AMOUNTS)[number];

export function isCreditPackAmount(value: unknown): value is CreditPackAmount {
  return typeof value === "number" && Number.isInteger(value) && (CREDIT_PACK_AMOUNTS as readonly number[]).includes(value);
}

/**
 * Libellés écran `/package?plan=credits`.
 * Bandeau = crédits ; corps = réduction affichée puis prix (prix TTC alignés sur Stripe `STRIPE_PRICE_CREDITS_*`).
 */
export const CREDIT_PACK_DISPLAY: Record<
  CreditPackAmount,
  {
    headerTitle: string;
    discountLine: string;
    priceLine: string;
    /** Sous le prix : accroche palier (souple / choisi / avantageux). */
    tagline: string;
    featured: boolean;
  }
> = {
  200: {
    headerTitle: "200 crédits",
    discountLine: "(10%)",
    priceLine: "17,99 €",
    tagline: "Le plus souple",
    featured: false,
  },
  500: {
    headerTitle: "500 crédits",
    discountLine: "(-30%)",
    priceLine: "34,99 €",
    tagline: "Le plus choisi",
    featured: true,
  },
  1000: {
    headerTitle: "1000 crédits",
    discountLine: "(-50%)",
    priceLine: "49,99 €",
    tagline: "Le plus avantageux",
    featured: false,
  },
};
